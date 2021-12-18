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
var cync_room_data = null
var cync_credentials = null
var google_credentials = null
var config = null
var entry_id = null

function log(message){
    console.log ( '[' + new Date().toISOString() + '] -', message )
}

function monitorCbygeSwitches(cync_credentials) {
	const type43 = new Uint8Array([0x43,0x00,0x00,0x00])
	const type83 = new Uint8Array([0x83,0x00,0x00,0x00])
	cbygeTcpServer = net.createConnection({ port: 23778, host: 'cm.gelighting.com' }, function() {
		log('Monitoring cbyge server for state changes...')      
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
					if (cync_room_data.switchID_to_room[deviceId]){
						var room = cync_room_data.switchID_to_room[deviceId]
						if (power != cync_room_data.rooms[room].switches[deviceId].state || brightness != cync_room_data.rooms[room].switches[deviceId].brightness){
							cync_room_data.rooms[room].switches[deviceId].state = power
							cync_room_data.rooms[room].switches[deviceId].brightness = brightness
							var currentStateAll = power
							for (let sw in cync_room_data.rooms[room].switches){
								if (cync_room_data.rooms[room].switches[sw].state != currentStateAll || cync_room_data.rooms[room].switches[sw].brightness != brightness){currentStateAll = !power}
							}
							if (currentStateAll == power){
								cync_room_data.rooms[room].state = power
								cync_room_data.rooms[room].brightness = brightness
								var state = power ? 'on':'off'
								var stateInfo = power ? {'entity_id':cync_room_data.rooms[room].entity_id,'brightness':Math.round(brightness*255/100)} : {'entity_id':cync_room_data.rooms[room].entity_id}
								if (cync_room_data.rooms[room].entity_id != ''){
									log('Updating ' + cync_room_data.rooms[room].entity_id + ' to ' + state + ' with brightness ' + brightness.toString())
									http.post('http://supervisor/core/api/services/light/turn_' + state, stateInfo, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
									.catch(function(err){log(err.message)})
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
	  	log('Disconnected from Cync TCP server')
	})      

	const maintainConnection = setInterval(function(){
		cbygeTcpServer.write(cync_credentials) 
	},120000)
}

function startGoogleAssistant(credentials){
	googleAssistant = spawn('python3',['./assistant_text_query.py'])
	googleAssistant.on('spawn',function(){
		log('Started Google Assistant, awaiting commands...')
		googleAssistant.stdin.write(JSON.stringify({'credentials':credentials}))
	})
	googleAssistant.stdout.on('data',function(data){
		log(data.toString())
	})
	googleAssistant.stderr.on('data',function(data){
		log(data.toString())
	})
	googleAssistant.on('exit',function(code){
		log('assistant_text_query.py exited')
	})
	googleAssistant.on('close',function(code){
		log('assistant_text_query.py closed')
	})

	//refresh google credentials every 12 hours
	setInterval(function(){
		googleAssistant.stdin.write(JSON.stringify({"refresh":"credentials"}))
	},43200000)
}

function googleAssistantQuery(room,state,brightness){
	if (googleAssistant){
		var switchNames = cync_room_data.rooms[room].switch_names
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
			log('Google assistant query: ' + query)
			googleAssistant.stdin.write('{"query":"' + query + '"}')
		}
	},count*300)
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
	http.post('http://supervisor/core/api/services/homeassistant/reload_config_entry', {'entry_id':entry_id}, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})
	.catch(function(err){log('Unable to reach the Cync Lights Integration. Please install and configure the integration.')})	
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
			http.post('http://supervisor/core/api/services/homeassistant/reload_config_entry', {'entry_id':entry_id}, {headers: {Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN}})		
		} else {
			log('Please install and configure the Cync Lights Integration')			
		}
	}).catch(function(err){
		log('Unable to connect to home assistant')		
	})
}

//Server for HA to send configuration data and initialize on startup
app.use(express.json()) // for parsing application/json
app.post('/init', function (req, res) {
	log('Cync Lights Addon initialized')
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
	if (!cync_room_data || !cync_credentials || !google_credentials){
		cync_room_data = req.body.cync_room_data
		cync_credentials = req.body.cync_credentials
		google_credentials = req.body.google_credentials
		if (!cbygeTcpServer){
			monitorCbygeSwitches(new Uint8Array(cync_credentials))
		}
		if (!googleAssistant){
			startGoogleAssistant(google_credentials)
		}
		if (!entry_id){
			entry_id = req.body.entry_id
			writeEntryId()
		}
	}
	if (cync_room_data.rooms[room]){
		cync_room_data.rooms[room] = room_data
		log("Added " + room)
	} else {
		log('Unable to add data for ' + room)
	}
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
