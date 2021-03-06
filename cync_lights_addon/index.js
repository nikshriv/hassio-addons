const net = require('net')
const http = require('axios')
const files = require('fs')
const process = require('process')
const WebSocket = require('ws').WebSocket
const {spawn} = require('child_process')
const EventEmitter = require('events')
const assistantQuery = new EventEmitter()
const integrationReload = new EventEmitter()
var queryArray = []
assistantQuery.setMaxListeners(0)

var express = require('express')
var app = express()

var googleAssistant = null
var cbygeTcpServer = null
var cync_room_data = null
var cync_credentials = null
var google_credentials = null
var config = null
var entry_id = null
var reconnecting = null
var maintainConnection = null

function log(message){
    console.log (message)
}

function monitorCbygeSwitches(credentials) {
	cbygeTcpServer = net.createConnection({ port: 23778, host: 'cm.gelighting.com' }, function() {
		log('Monitoring cbyge server for state changes...')      
	})
	cbygeTcpServer.on('connect', function(){
		cbygeTcpServer.write(credentials)
		maintainConnection = setInterval(function(){
			cbygeTcpServer.write(credentials) 
		},120000)
		if (reconnecting) {
			clearInterval(reconnecting)
			reconnecting = null
		}		
	})
	cbygeTcpServer.on('data', function(data){
		var packetLength = 0
		var packetType = 0
		var packet = []
		while (data.length >= 5) {
			packetType = data.readUInt8(0)
			packetLength = data.readUInt32BE(1)
			packet =  data.slice(5,packetLength + 5)
			data = data.length > packetLength + 5 ? data.slice(packetLength + 5):[]
			switch (packetType){
				case 67:	//state change
				case 131:	//packet handler
					if (packetLength >= 13) {
						if (packet.readUInt32BE(4) == 16844293){
							var power = packet.readUInt8(11) > 0
							var brightness = packet.readUInt8(12)
							var deviceId = packet.readUInt32BE(0)
							if (cync_room_data.switchID_to_room[deviceId]){
								var room = cync_room_data.switchID_to_room[deviceId]
								if (power != cync_room_data.rooms[room].switches[deviceId].state || brightness != cync_room_data.rooms[room].switches[deviceId].brightness){
									cync_room_data.rooms[room].switches[deviceId].state = power
									cync_room_data.rooms[room].switches[deviceId].brightness = brightness
									cync_room_data.rooms[room].updateHomeAssistantState()
								}
							}
						}
					}
					break
			}
		} 
	})      
	cbygeTcpServer.on('end', function(){
	  	log('Disconnected from Cync TCP server...attempting to reconnect in 2 minutes')
		if (maintainConnection){
			clearInterval(maintainConnection)
			maintainConnection = null
		}
		reconnecting =  setInterval(function(){
			monitorCbygeSwitches(credentials)
		},120000)
	})      
}

function updateHomeAssistantState(){
	var room = this
	if (room.updateStateTimer){
		clearTimeout(room.updateStateTimer)
	}
	room.updateStateTimer = setTimeout(function(){
		var currentRoomState = false
		var roomBrightnessTotal = 0
		var switchCount = 0
		for (let sw in room.switches){
			switchCount++
			if (room.switches[sw].state) {
				currentRoomState = true
				roomBrightnessTotal = roomBrightnessTotal + room.switches[sw].brightness
			}			
		}
		room.state = currentRoomState
		room.brightness = Math.round(roomBrightnessTotal/switchCount)
		if (room.entity_id != ''){
			var state = room.state ? 'on':'off'
			var stateInfo = room.state ? {'entity_id':room.entity_id,'brightness':room.brightness*255/100} : {'entity_id':room.entity_id}
			log('Updating ' + room.entity_id + ' to ' + state + ' with brightness ' + room.brightness.toString())
			http.post('http://supervisor/core/api/services/light/turn_' + state, stateInfo, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
			.catch(function(err){log(err.message)})
		}
	},1000)
}

function startGoogleAssistant(credentials){
	googleAssistant = spawn('python3',['-u','./assistant_text_query.py'])
	googleAssistant.on('spawn',function(){
		log('Started Google Assistant, awaiting commands...')
		googleAssistant.stdin.write(JSON.stringify({'credentials':credentials}))
	})
	googleAssistant.stdout.on('data',function(data){
		var message = data.toString().replaceAll(' ','').trim()
		if (message != ''){
			assistantQuery.emit(message)
			log('Assistant Received Request: ' + data.toString())
		}
	})
	googleAssistant.stderr.on('data',function(data){
		log(data.toString())
		if (googleAssistant){
			googleAssistant.kill()
			googleAssistant = null
		}
	})
	googleAssistant.on('error',function(){
		if (googleAssistant){
			googleAssistant.kill()
			googleAssistant = null
		}
	})
	googleAssistant.on('exit',function(code){
		log('assistant_text_query.py exited, restarting Google Assistant')
		startGoogleAssistant(credentials)
	})
}

function googleAssistantQuery(room,state,brightness){
	if (googleAssistant){
		var switchNames = cync_room_data.rooms[room].switch_names
		for (var i = 0; i < switchNames.length; i++){
			if (brightness){
				sendQuery("Set " + switchNames[i] + " to " + brightness.toString() + "%")
			} else {
				sendQuery(state ? "Turn on " + switchNames[i] : "Turn off " + switchNames[i])
			}
		}
	}
}

function sendQuery(query){
	queryArray.push(query)
	assistantQuery.once(query.replaceAll(' ','').trim(),function(){
		queryArray.splice(queryArray.indexOf(query),1)
		if (queryArray.length > 0) {
			googleAssistant.stdin.write('{"query":"' + queryArray[0] + '"}')	
		}
	})
	if (queryArray.length == 1){
		googleAssistant.stdin.write('{"query":"' + query + '"}')
	}
}

function writeEntryId(){
	files.writeFile('entry_id.json',JSON.stringify({'entry_id':entry_id}),function(err){
		if (err){
			log(err.message)
		}
	})
}

//At addon startup, check if the Cync Lights Integration was previously installed and configured, then reload the Integration to initialize this addon
if (files.existsSync('entry_id.json')){
	entry_id = JSON.parse(files.readFileSync('entry_id.json','utf8')).entry_id
	log('Reloading Cync Lights Integration using saved entry_id')
	reloadIntegration()
} else {
	http.get('http://supervisor/core/api/config/config_entries/entry',{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}}).then(function(response){
		var configEntries = response.data
		configEntries.forEach(function(entry){
			if (entry.domain == 'cync_lights'){
				entry_id = entry.entry_id
			}
		})
		if (entry_id){
			writeEntryId()
			log('Reloading Cync Lights Integration')
			reloadIntegration()
		} else {
			log('Please install and configure the Cync Lights Integration')			
		}
	}).catch(function(err){
		log('Unable to connect to home assistant')		
	})
}

function reloadIntegration(){
	var reloadAttemptInterval = null
	integrationReload.once('reloaded',function(){
		if (reloadAttemptInterval) {
			clearInterval(reloadAttemptInterval)
		}
	})
	reload()
	reloadAttemptInterval = setInterval(reload,5000)
	function reload(){
		http.post('http://supervisor/core/api/services/homeassistant/reload_config_entry', {'entry_id':entry_id}, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
		.catch(function(err){log('Unable to reload Cync Lights Integration...trying again in 5 seconds')})		
	}
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/init', function (req, res) {
	log('Cync Lights Addon initialized')
	if (reconnecting){
		clearInterval(reconnecting)
		reconnecting = null
	}
	if (maintainConnection){
		clearInterval(maintainConnection)
		maintainConnection = null
	}
	if (googleAssistant){
		googleAssistant.kill()
		googleAssistant = null
	}
	if (cbygeTcpServer) {
		cbygeTcpServer.destroy()
		cbygeTcpServer = null
	}
	cync_room_data = null
	cync_credentials = null
	google_credentials = null
	res.send('Cync Addon initiated')
})
app.post('/setup', function (req, res){
	var room = req.body.room
	var room_data = req.body.room_data
	integrationReload.emit('reloaded')
	if (!google_credentials){
		google_credentials = req.body.google_credentials
		if (!googleAssistant){
			startGoogleAssistant(google_credentials)
		}		
	}
	if (!cync_credentials){
		cync_credentials = req.body.cync_credentials
		if (!cbygeTcpServer){
			monitorCbygeSwitches(new Uint8Array(cync_credentials))
		}
	}
	if (!entry_id){
		entry_id = req.body.entry_id
		writeEntryId()
	}
	if (!cync_room_data){
		cync_room_data = req.body.cync_room_data
	}
	var state = ''
	if (room_data.state){
		room_data.brightness = Math.round(room_data.brightness*100/255)
		state = 'on'
	} else {
		room_data.brightness = 0
		state = 'off'
	}
	cync_room_data.rooms[room] = room_data
	cync_room_data.rooms[room]["updateHomeAssistantState"] = updateHomeAssistantState
	cync_room_data.rooms[room]["updateStateTimer"] = null
	log('Registered ' + room + ' with state ' + state + ' and brightness ' + room_data.brightness.toString())
	res.send('Received ' + room)
})
app.post('/turn-on', function (req, res) {
	var room = req.body.room
	if (!cync_room_data.rooms[room].state){
		cync_room_data.rooms[room].state = true
		googleAssistantQuery(room,true)
	}
	res.send('Received state update')
})
app.post('/set-brightness', function (req, res) {
	var room = req.body.room
	var brightness = req.body.brightness
	if (!cync_room_data.rooms[room].state){
		cync_room_data.rooms[room].state = true
		cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	} else if (cync_room_data.rooms[room].state && cync_room_data.rooms[room].brightness != brightness) {
		cync_room_data.rooms[room].brightness = brightness
		googleAssistantQuery(room,true,brightness)
	}
	res.send('Received state update')
})
app.post('/turn-off', function (req, res) {
	var room = req.body.room
	if (cync_room_data.rooms[room].state){
		cync_room_data.rooms[room].state = false
		cync_room_data.rooms[room].brightness = 0
		googleAssistantQuery(room,false)
	}
	res.send('Received state update')
})
var server = app.listen(3001,function(){
	log('Cync Lights Addon started...')
})
