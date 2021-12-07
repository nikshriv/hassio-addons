const net = require('net')
const http = require('axios')
const files = require('fs')
const process = require('process')
const WebSocket = require('ws').WebSocket
const {spawn} = require('child_process')

var express = require('express')
var app = express()

var haWebsocket = null
var haEntityIDs = {}
var googleAssistant = null
var cbygeTcpServer = null
var cync_data = null
var cync_credentials = null

function connectToHomeAssistant(){
	haWebsocket = new WebSocket('ws://supervisor/core/websocket')

	haWebsocket.on('message',function(data){
		resp = JSON.parse(data.toString())
		switch (resp.type){
			case 'auth_required':
				// log in to home assistant
				haWebsocket.send('{"type":"auth","access_token":"' + process.env.SUPERVISOR_TOKEN + '"}')
				break
			case 'auth_ok':
				haWebsocket.send('{"id":"1","type":"get_states"}') //get attributes of devices in Home Assistant
				haWebsocket.send('{"id":"2","type":"subscribe_events","event_type":"state_changed"}') // subscribe to cbyge switch state changes
				break
			case 'result': // store entity_ids in haEntityIDs
				if (resp.id == 1) {
					resp.result.forEach(function(switchResult){
						if (switchResult.attributes.device_type == 'cync') {
							haEntityIDs[switchResult.attributes.friendly_name] = switchResult.entity_id
						}
					})
				}
				break
			case 'event': // receive home assistant switch state changes
				var room = resp.event.data.new_state.attributes.friendly_name 
				if (resp.id == 2 && cync_data['cync_room_data']['rooms'][room]) {				
					if (resp.event.data.new_state.state == 'off' && cync_data['cync_room_data']['rooms'][room].state){
						cync_data['cync_room_data']['rooms'][room].state = false
						cync_data['cync_room_data']['rooms'][room].brightness = 0
						googleAssistantQuery(room,false)
					}
					else if (resp.event.data.new_state.state == 'on' && !cync_data['cync_room_data']['rooms'][room].state){
						if (Math.round(resp.event.data.new_state.attributes.brightness*100/255) != cync_data['cync_room_data']['rooms'][room].brightness) {
							cync_data['cync_room_data']['rooms'][room].state = true
							cync_data['cync_room_data']['rooms'][room].brightness = Math.round(resp.event.data.new_state.attributes.brightness*100/255)
							googleAssistantQuery(room,true,cync_data['cync_room_data']['rooms'][room].brightness)
						} 
						else {
							googleAssistantQuery(room,true)
						}
					}
					else if (resp.event.data.new_state.state == 'on' && cync_data['cync_room_data']['rooms'][room].state){
						if (Math.round(resp.event.data.new_state.attributes.brightness*100/255) != cync_data['cync_room_data']['rooms'][room].brightness) {
							cync_data['cync_room_data']['rooms'][room].state = true
							cync_data['cync_room_data']['rooms'][room].brightness = Math.round(resp.event.data.new_state.attributes.brightness*100/255)
							googleAssistantQuery(room,true,cync_data['cync_room_data']['rooms'][room].brightness)
						}
					}
				}
				break
		}
	})
	haWebsocket.on('error',function(err){
		console.log(err)
	})
	haWebsocket.on('exit',function(){
		haWebsocket = null
	})
}

function monitorCbygeSwitches() {
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
					if (cync_data['cync_room_data']['switchID_to_room'][deviceId]){
						var room = cync_data['cync_room_data']['switchID_to_room'][deviceId]
						if (!power && cync_data['cync_room_data']['rooms'][room]['switches'][deviceId].state){
							var currentStateAll = false
							for (let sw in cync_data['cync_room_data']['rooms'][room]['switches']){
								if (cync_data['cync_room_data']['rooms'][room]['switches'][sw].state){currentStateAll = true}
							}
							if (!currentStateAll){
								cync_data['cync_room_data']['rooms'][room].state = power
								cync_data['cync_room_data']['rooms'][room].brightness = brightness
								http.post('http://supervisor/core/api/services/light/turn_off',{entity_id:haEntityIDs[room]},{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
								.catch(function(err){console.log(err)})								
							}
						}
						else if (power && (!cync_data['cync_room_data']['rooms'][room].state || cync_data['cync_room_data']['rooms'][room].brightness != brightness)){
							cync_data['cync_room_data']['rooms'][room].state = power
							cync_data['cync_room_data']['rooms'][room].brightness = brightness
							http.post('http://supervisor/core/api/services/light/turn_on',{entity_id:haEntityIDs[room],brightness:Math.round(brightness*255/100)},{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
							.catch(function(err){console.log(err)})
						}
						console.log("device: ", deviceId,"\tpower on: ", power,"\tbrightness: ", brightness)
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
		cbygeTcpServer = null
		clearInterval(maintainConnection)
	})      

	const maintainConnection = setInterval(function(){
		cbygeTcpServer.write(cync_credentials) 
	},120000)
}

function startGoogleAssistant(credentials){
	googleAssistant = spawn('python3',['./assistant_text_query.py'])
	googleAssistant.on('spawn',function(){
		googleAssistant.stdin.write('{"credentials":"' + JSON.stringify(credentials) + '"}')
	})
	googleAssistant.stdout.on('data',function(data){
		console.log(data.toString())
	})
	googleAssistant.on('error',function(err){
		console.log(err)
	})
	googleAssistant.on('exit',function(code){
		console.log('asisstant_text_query.py exited with code: ',code)
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
	cync_credentials = new Uint8Array(cync_data['cync_credentials'])
	if (!haWebsocket){
		connectToHomeAssistant()
	}
	if (!cbygeTcpServer){
		monitorCbygeSwitches()
	}
} else {
	console.log('Please start configuration with Cync Itegration')
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/setup', function (req, res) {
	console.log('Setting up new instance')
	cync_data = req.body
	files.writeFileSync('cync_data.json',JSON.stringify(req.body))
	res.send('Received configuration data')
})
app.get('/init', function (req, res) {
	console.log('Initializing')
	if (cync_data){
		cync_credentials = new Uint8Array(cync_data['cync_credentials'])
		if (!haWebsocket){
			connectToHomeAssistant()
		}
		if (!cbygeTcpServer){
			monitorCbygeSwitches()
		}
		if (!googleAssistant){
			startGoogleAssistant(cync_data['google_credentials'])
		}
		res.send('Initialized, monitoring Cync Server and HA for changes')
	} else {
		res.send('Initialization failed, please setup again')
	}
})
var server = app.listen(3001,function(){
	console.log('Cync Server listening for init call from Cync Integration...')
})

//When addon exits or is restarted, save current cync_data
process.on('exit',function(){
	console.log('Saving cync_data')
	files.writeFileSync('cync_data.json',JSON.stringify(cync_data))
})