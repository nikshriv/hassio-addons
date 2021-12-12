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
var config = null

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
					if (config.cync_room_data.switchID_to_room[deviceId]){
						var room = config.cync_room_data.switchID_to_room[deviceId]
						if (power != config.cync_room_data.rooms[room].switches[deviceId].state || brightness != config.cync_room_data.rooms[room].switches[deviceId].brightness){
							config.cync_room_data.rooms[room].switches[deviceId].state = power
							config.cync_room_data.rooms[room].switches[deviceId].brightness = brightness
							var currentStateAll = power
							for (let sw in config.cync_room_data.rooms[room].switches){
								if (config.cync_room_data.rooms[room].switches[sw].state != currentStateAll || config.cync_room_data.rooms[room].switches[sw].brightness != brightness){currentStateAll = !power}
							}
							if (currentStateAll == power){
								config.cync_room_data.rooms[room].state = power
								config.cync_room_data.rooms[room].brightness = brightness
								var state = power ? 'on':'off'
								var stateInfo = power ? {'entity_id':config.cync_room_data.rooms[room].entity_id,'brightness':Math.round(brightness*255/100)} : {'entity_id':config.cync_room_data.rooms[room].entity_id}
								if (config.cync_room_data.rooms[room].entity_id != ''){
									console.log('Updating ' + config.cync_room_data.rooms[room].entity_id + ' to ' + state + ' with brightness ' + brightness.toString())
									http.post('http://supervisor/core/api/services/light/turn_' + state, stateInfo, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
									.catch(function(err){console.log(err.message)})
								}						
							}
						}
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
		googleAssistant.stdin.write(JSON.stringify({'credentials':credentials}))
	})
	googleAssistant.stdout.on('data',function(data){
		console.log(data.toString())
	})
	googleAssistant.stderr.on('data',function(data){
		console.log(data.toString())
	})
	googleAssistant.on('exit',function(code){
		console.log('assistant_text_query.py exited with code: ',code)
	})
	googleAssistant.on('close',function(code){
		console.log('assistant_text_query.py closed with code: ',code)
	})

	//refresh google credentials every 12 hours
	setInterval(function(){
		googleAssistant.stdin.write(JSON.stringify({"refresh":"credentials"}))
	},43200000)
}

function googleAssistantQuery(room,state,brightness){
	if (googleAssistant){
		var query = ""
		var count = 0
		for (let sw in config.cync_room_data.rooms[room].switches){
			count++
			if (brightness){
				query = "Set " + config.cync_room_data.rooms[room].switches[sw].name + " to " + brightness.toString() + "%"
			} else {
				query = state ? "Turn on " + config.cync_room_data.rooms[room].switches[sw].name : "Turn off " + config.cync_room_data.rooms[room].switches[sw].name
			}
			setTimeout(function(){
				if (googleAssistant){
					googleAssistant.stdin.write('{"query":"' + query + '"}')
				}
			},count*100)
		}
	}
}

//At addon startup, check if config exists, otherwise wait for setup and initialization from HA
if (files.existsSync('cync_data.json')){
	config = JSON.parse(files.readFileSync('cync_data.json','utf8'))
	if (!googleAssistant){
		startGoogleAssistant(config.google_credentials)
	}
	if (!cbygeTcpServer){
		monitorCbygeSwitches(new Uint8Array(config.cync_credentials))
	}
} else {
	console.log('Please start configuration with Cync Itegration')
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/setup', function (req, res) {
	console.log('Setting up new instance')
	config = req.body
	if (!googleAssistant){
		startGoogleAssistant(config.google_credentials)
	}
	if (!cbygeTcpServer){
		monitorCbygeSwitches(new Uint8Array(config.cync_credentials))
	}
	files.writeFileSync('cync_data.json',JSON.stringify(req.body))
	res.send('Received configuration data')
})
app.post('/init', function (req, res){
	var room = req.body.room
	var room_data = req.body.room_data
	if (config.cync_room_data.rooms[room]){
		config.cync_room_data.rooms[room] = room_data
		console.log("Added " + room)
	} else {
		console.log('Unable to add data for ' + room)
	}
	res.send('Received ' + room)
})
app.post('/turn-on', function (req, res) {
	var room = req.body.room
	if (!config.cync_room_data.rooms[room].state){
		config.cync_room_data.rooms[room].state = true
		googleAssistantQuery(room,true)
	}
	res.send('Received state update')
})
app.post('/set-brightness', function (req, res) {
	var room = req.body.room
	var brightness = req.body.brightness
	if (!config.cync_room_data.rooms[room].state){
		config.cync_room_data.rooms[room].state = true
		config.cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	} else if (config.cync_room_data.rooms[room].state && config.cync_room_data.rooms[room].brightness != brightness) {
		config.cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	}
	res.send('Received state update')
})
app.post('/turn-off', function (req, res) {
	var room = req.body.room
	if (config.cync_room_data.rooms[room].state){
		config.cync_room_data.rooms[room].state = false
		config.cync_room_data.rooms[room].brightness = 0
		googleAssistantQuery(room,false)
	}
	res.send('Received state update')
})
var server = app.listen(3001,function(){
	console.log('Cync Server listening for init call from Cync Integration...')
})

//When addon exits or is restarted, save current config
process.on('exit',function(){
	console.log('Saving config')
	files.writeFileSync('cync_data.json',JSON.stringify(config))
})