const net = require('net')
const http = require('axios')
const files = require('fs')
const process = require('process')
const WebSocket = require('ws').WebSocket
const {spawn} = require('child_process')

var express = require('express')
var app = express()

var googleAssistant = null
var cbygeTcpServer = null
var cync_data = null

function monitorCbygeSwitches(cync_credentials) {
	const type43 = new Uint8Array([0x43,0x00,0x00,0x00])
	const type83 = new Uint8Array([0x83,0x00,0x00,0x00])
	cbygeTcpServer = net.createConnection({ port: 23778, host: 'cm.gelighting.com' }, function() {
		console.log('Monitoring cbyge server for state changes...')      
		cbygeTcpServer.write(cync_credentials)
	})      
	cbygeTcpServer.on('data', function(data){
		var type43Index = data.indexOf(type43)
		var type83Index = data.indexOf(type83)
		var index = type43Index >= 0 || type83Index >= 0 ? (type43Index>=0 && (type83Index<0 || type43Index<type83Index)) ? type43Index: type83Index>=0 ? type83Index:-1:-1
		while (index >=0) {
			if (data.length >= index + 18) {
				if (data.readUInt32BE(index + 9) == 16844293){
					var power = data.readUInt8(index + 16) > 0
					var brightness = data.readUInt8(index + 17)
					var deviceId = data.readUInt32BE(index + 5).toString()
					if (cync_data.cync_room_data.switchID_to_room[deviceId]){
						var room = cync_data.cync_room_data.switchID_to_room[deviceId]
						if (!power && cync_data.cync_room_data.rooms[room].switches[deviceId].state){
							cync_data.cync_room_data.rooms[room].switches[deviceId].state = power
							var currentStateAll = false
							for (let sw in cync_data.cync_room_data.rooms[room].switches){
								if (cync_data.cync_room_data.rooms[room].switches[sw].state){currentStateAll = true}
							}
							if (!currentStateAll){
								cync_data.cync_room_data.rooms[room].state = power
								cync_data.cync_room_data.rooms[room].brightness = brightness
								console.log('Turning off ' + room)
								if (cync_data.cync_room_data.rooms[room].entity_id != ''){
									http.post('http://supervisor/core/api/services/light/turn_off',{'entity_id':cync_data.cync_room_data.rooms[room].entity_id},{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
									.catch(function(err){console.log(err.message)})
								}						
							}
						}
						else if (power && (!cync_data.cync_room_data.rooms[room].state || cync_data.cync_room_data.rooms[room].brightness != brightness)){
							cync_data.cync_room_data.rooms[room].state = power
							cync_data.cync_room_data.rooms[room].brightness = brightness
							console.log("Turning on " + room)
							if (cync_data.cync_room_data.rooms[room].entity_id != ''){
								http.post('http://supervisor/core/api/services/light/turn_on',{'entity_id':cync_data.cync_room_data.rooms[room].entity_id,brightness:Math.round(brightness*255/100)},{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
								.catch(function(err){console.log(err.message)})
							}
						}
						console.log("device: ", cync_data.cync_room_data.rooms[room].switches[deviceId].name, "\tpower on: ", power,"\tbrightness: ", brightness)
					}
				}
			}
			data = data.slice(index +1)
			type43Index = data.indexOf(type43)
			type83Index = data.indexOf(type83)
			index = type43Index >= 0 || type83Index >= 0 ? (type43Index>=0 && (type83Index<0 || type43Index<type83Index)) ? type43Index: type83Index>=0 ? type83Index:-1:-1
		} 
	})      
	cbygeTcpServer.on('end', function(){
	  	console.log('Disconnected from Cync TCP server')
	})      

	const maintainConnection = setInterval(function(){
		cbygeTcpServer.write(cync_credentials) 
	},120000)
}

function startGoogleAssistant(credentials){
	googleAssistant = spawn('python3',['./assistant_text_query.py'])
	googleAssistant.on('spawn',function(){
		var creds = JSON.stringify({'credentials':credentials})
		console.log(creds)
		googleAssistant.stdin.write(creds)
	})
	googleAssistant.stdout.on('data',function(data){
		console.log(data.toString())
	})
	googleAssistant.on('error',function(err){
		console.log(err)
	})
	googleAssistant.on('exit',function(code){
		console.log('assistant_text_query.py exited with code: ',code)
	})
	googleAssistant.on('close',function(code){
		console.log('assistant_text_query.py closed with code: ',code)
	})
}

function googleAssistantQuery(room,state,brightness){
	if (googleAssistant){
		var query = ""
		var switchNames = ""
		if (brightness){
			query = "Set brightness to " + brightness.toString() + " for "
		} else {
			query = state ? "Turn on " : "Turn off "
		}
		for (let sw in cync_data['cync_room_data']['rooms'][room]['switches']){
			switchNames = switchNames + "and " + cync_data['cync_room_data']['rooms'][room]['switches'][sw]['name']
		}
		switchNames = switchNames.slice(4)
		query = query + switchNames
		googleAssistant.stdin.write('{"query":"' + query + '"}')
	}
}

//At addon startup, check if cync_data exists, otherwise wait for setup and initialization from HA
if (files.existsSync('cync_data.json')){
	cync_data = JSON.parse(files.readFileSync('cync_data.json','utf8'))
	if (!cbygeTcpServer){
		monitorCbygeSwitches(new Uint8Array(cync_data.cync_credentials))
	}
	if (!googleAssistant){
		startGoogleAssistant(cync_data.google_credentials)
	}
} else {
	console.log('Please start configuration with Cync Itegration')
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/setup', function (req, res) {
	console.log('Setting up new instance')
	cync_data = req.body
	if (!cbygeTcpServer){
		monitorCbygeSwitches(new Uint8Array(cync_data.cync_credentials))
	}
	if (!googleAssistant){
		startGoogleAssistant(cync_data.google_credentials)
	}
	files.writeFileSync('cync_data.json',JSON.stringify(req.body))
	res.send('Received configuration data')
})
app.post('/turn-on', function (req, res) {
	var room = req.body.room
	var brightness = req.body.brightness
	if (cync_data.cync_room_data.rooms[room].state == false){
		cync_data.cync_room_data.rooms[room].state = true
		cync_data.cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	} else if (cync_data.cync_room_data.rooms[room].state == true && cync_data.cync_room_data.rooms[room].brightness != brightness) {
		cync_data.cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	}
	res.send('Received state update')
})
app.post('/turn-off', function (req, res) {
	var room = req.body.room
	if (cync_data.cync_room_data.rooms[room].state == true){
		cync_data.cync_room_data.rooms[room].state = false
		cync_data.cync_room_data.rooms[room].brightness = 0
		googleAssistantQuery(room,false)
	}
	res.send('Received state update')
})
app.post('/entity-id', function (req, res){
	var room = req.body.room
	var entity_id = req.body.entity_id
	if (cync_data.cync_room_data.rooms[room]){
		console.log('Added ' + entity_id + ' to ' + room)
		cync_data.cync_room_data.rooms[room].entity_id = entity_id
	} else {
		console.log('Unable to add entity ' + entity_id)
	}
	res.send('Received ' + entity_id)
})
var server = app.listen(3001,function(){
	console.log('Cync Server listening for init call from Cync Integration...')
})

//When addon exits or is restarted, save current cync_data
process.on('exit',function(){
	console.log('Saving cync_data')
	files.writeFileSync('cync_data.json',JSON.stringify(cync_data))
})