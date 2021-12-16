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
var entry_id = null

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
		console.log('Started Google Assistant, awaiting commands...')
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
		var queries = []
		var switchNames = config.cync_room_data.rooms[room].switch_names
		for (var i = 0; i < switchNames.length; i++){
			if (brightness){
				sendQuery("Set " + switchNames[i] + " to " + brightness.toString() + "%",i)
			} else {
				sendQuery(state ? "Turn on " + switchNames[i] : "Turn off " + switchNames[i],i)
			}
		}
	}
}

function sendQuery(query,count){
	setTimeout(function(){
		if (googleAssistant){
			console.log('Google assistant query sent: ' + query)
			googleAssistant.stdin.write('{"query":"' + query + '"}')
		}
	},count*300)
}

//At addon startup, check if the Cync Lights Integration was previously installed and configured, then reload the Integration to initialize this addon
if (files.existsSync('entry_id.json')){
	entry_id = JSON.parse(files.readFileSync('entry_id.json','utf8')).entry_id
	http.post('http://supervisor/core/api/services/homeassistant/reload_config_entry', {'entry_id':entry_id}, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
	.catch(function(err){console.log('Unable to reach the Cync Lights Integration. Please install and configure the integration.')})	
} else {
	http.get('http://supervisor/core/api/config/config_entries/entry',{headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}}).then(function(response){
		var configEntries = response.data
		configEntries.forEach(function(entry){
			if (entry.domain == 'cync_lights'){
				entry_id = entry.entry_id
			}
		})
		if (entry_id){
			files.writeFileSync('entry_id.json',JSON.stringify({'entry_id':entry_id}))
			http.post('http://supervisor/core/api/services/homeassistant/reload_config_entry', {'entry_id':entry_id}, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})		
		} else {
			console.log('Please install and configure the Cync Lights Integration')			
		}
	}).catch(function(err){
		console.log('Unable to connect to home assistant')		
	})
}

function writeEntryId(){
	files.writeFile('entry_id.json',JSON.stringify({'entry_id':entry_id}),function(err){
		console.log(err)
	})
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/init', function (req, res) {
	console.log('Cync Lights Addon initialized')
	if (googleAssistant){
		googleAssistant.kill()
		googleAssistant = null
	}
	if (cbygeTcpServer) {
		cbygeTcpServer.destroy()
		cbygeTcpServer = null
	}
	config = null
	res.send('Cync Addon initiated')
})
app.post('/setup', function (req, res){
	var room = req.body.room
	var room_data = req.body.room_data
	if (!config){
		config = req.body.setup_data
	}
	if (config.cync_room_data.rooms[room]){
		config.cync_room_data.rooms[room] = room_data
		console.log("Added " + JSON.stringify(room_data))
	} else {
		console.log('Unable to add data for ' + room)
	}
	if (!cbygeTcpServer){
		monitorCbygeSwitches()
	}
	if (!googleAssistant){
		startGoogleAssistant()
	}
	if (!entry_id){
		entry_id = req.body.entry_id
		writeEntryId()
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
	console.log('Cync Lights Addon started...')
})
