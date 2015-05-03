'use strict';


navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia 
							|| navigator.mozGetUserMedia;

// ANTES DE CERRAR LA VENTANA, PROHIBIMOS LAS ACCIONES DE COMUNICACION
window.onbeforeunload = function(e){
	hangup();
}

var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");
var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

//Cuando pulsamos el boton enviar, en el chat, ejecutamos la funcion sendData
sendButton.onclick = sendData;

// INICIALMENTE ponemos todas las variables false, hasta que no se conecte alguien al canal
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

// Declaramos las dos variables que contendran los flujos de video, el nuestro y el del otro peer y la conexion peerconection
var localStream;
var remoteStream;
var pc;

// configuramos ICE para cada navegador firefox o chrome
var pc_config = webrtcDetectedBrowser === 'firefox' ?
  {'iceServers':[{'url':'stun:23.21.150.121'}]} : // IP address
  {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};
  
var pc_constraints = {
  'optional': [
    {'DtlsSrtpKeyAgreement': true}
  ]};

var sdpConstraints = {};
/////////////////////////////////////////////

// LE PEDIMOS AL USUSARIO QUE INTRODUZCA NOMBRE DE ROOM
var room = prompt('Enter room name:');

// NOS CONECTAMOS AL SERVIDOR DE SEÑALIZACON PARA EMPEZAR LA SEÑALIZACION CON EL OTRO PEER
var socket = io.connect("http://localhost:8181");

// SI EL NOMBRE DE LA ROOM QUE HEMOS INTRODUCIDO CONTIENE CARACTERES, AVISAMOS DE QUE LA HEMOS CREADO O SI YA ESTABA, NOS HEMOS UNIDO
if (room !== '') {
  console.log('Create or join room', room);
  socket.emit('create or join', room);
}

// DECLARAMOS QUE VAMOS A QUERER TANTO VIDEO COMO AUDIO PARA NUESTRO GETUSERMEDIA
var constraints = {video: true, audio: true};


// SI LA PETICION DE GETUSERMEDIA HA SIDO SATISFACTORIA, ASIGNAMOS EL STREAM A NUESTRO STREAM LOCAL
function handleUserMedia(stream) {
	localStream = stream;
	attachMediaStream(localVideo, stream);
	console.log('Adding local stream.');
	sendMessage('got user media');
}

// SI LA PETICION DE GETUSERMEDIA HA SIDO CANCELADA POR EL USUARIO O POR ALGUNA OTRA RAZON, INFORMAMOS DE QUE NO SE HA PODIDO REALIZAR
function handleUserMediaError(error){
	console.log('navigator.getUserMedia error: ', error);
}


//SI HEMOS SIDO LOS PRIMEROS EN ENTRAR AL CANAL, SE NOS ACTIVA DE QUE HEMOS SIDO EL INICIADOR
socket.on('created', function (room){
  console.log('Created room ' + room);
  isInitiator = true;
  
//INFORMAMOS AL NAVEGADOR DE NUESTRO FLUJO DE DATOS (AUDIO Y VIDEO) 
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
  
  checkAndStart(); 
});

// SI YA HAY DOS USUARIOS CONECTADOS EN ESTA SALA, NO PODEMOS CONECTARNOS, webRTC esta implementado para pares
socket.on('full', function (room){
  console.log('Room ' + room + ' is full');
});

// si somos los segundos en entrar a la sala ya tenemos el canal activo, por lo que la variable isChannelReady del otro user se trunca a TRUE
socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

// Y nuestra variable ChannelReady, también se cambia a TRUE
socket.on('joined', function (room){
  console.log('This peer has joined room ' + room);
  isChannelReady = true;
  
// SI SOMOS LOS SEGUNDOS, IGUALMENTE SE HACE LA ASIGNACION DE NUESTRO FLUJO DE DATOS A NUESTRO NAVEGADOR
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
});

// PARA REPRODUCIR LOS MENSAJES DE TRAZAS
socket.on('log', function (array){
  console.log.apply(console, array);
});

// Receive message from the other peer via the signalling server 
socket.on('message', function (message){
  console.log('Received message:', message);
  if (message === 'got user media') {
      checkAndStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({sdpMLineIndex:message.label,
      candidate:message.candidate});
    pc.addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});
////////////////////////////////////////////////

// 2. Client-->Server
////////////////////////////////////////////////
//PARA ENVIAR MENSAJES AL OTRO PEER MEDIANTE EL SERVIDOR DE SEÑALIZACION
function sendMessage(message){
  console.log('Sending message: ', message);
  socket.emit('message', message);
}
////////////////////////////////////////////////////

////////////////////////////////////////////////////
// Channel negotiation trigger function

// SI no hemos empezado aún, el tipo de strem es apto y el canal esta preparado, creamos la conexion peer to peer, y la 
// variable isStarted pasa a ser TRUE y el que haya iniciado el CANAL hace la llamada
function checkAndStart() {
  
  if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {  
	createPeerConnection();
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

/////////////////////////////////////////////////////////
// REALIZAMOS LA CONEXION PEER TO PEER CON LAS IP DE CADA PEER, A PARTIR DE AQUI LA CONEXION SERA ENTRE PARES
function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pc_config, pc_constraints);
    
    console.log("Calling pc.addStream(localStream)! Initiator: " + isInitiator);
    pc.addStream(localStream);
    
    pc.onicecandidate = handleIceCandidate;
    console.log('Created RTCPeerConnnection with:\n' +
      '  config: \'' + JSON.stringify(pc_config) + '\';\n' +
      '  constraints: \'' + JSON.stringify(pc_constraints) + '\'.'); 
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
      return;
  }

  pc.onaddstream = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;

  if (isInitiator) {
    try {
      // Create a reliable data channel
      sendChannel = pc.createDataChannel("sendDataChannel",
        {reliable: true});
      trace('Created send data channel');
    } catch (e) {
      alert('Failed to create data channel. ');
      trace('createDataChannel() failed with exception: ' + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange; //si somos el initiator, cambiamos las variables que teniamos denegadas para
    sendChannel.onmessage = handleMessage; // poder empezar a hablar, y habilitamos la posibilidad de enviar informacion
    sendChannel.onclose = handleSendChannelStateChange; //cuando cierra el otro peer, lo volvemos a desactivar
  } else { // Joiner    
    pc.ondatachannel = gotReceiveChannel; // si somos el unido, nos preparamos igual para poder establecer la conexion de datos.
  }
}

//INFORMACION DE TEXTO QUE ENVIAMOS DE UN PEER A OTRO
function sendData() {
  var data = sendTextarea.value;
  if(isInitiator) sendChannel.send(data);
  else receiveChannel.send(data);
  trace('Sent data: ' + data);
  sendTextarea.value = '';
}

// Handlers...

function gotReceiveChannel(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
  trace('Received message: ' + event.data);
  receiveTextarea.value += event.data + '\n';
}

function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "";
    sendButton.disabled = false;
  } else {
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  trace('Receive channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
	    dataChannelSend.disabled = false;
	    dataChannelSend.focus();
	    dataChannelSend.placeholder = "";
	    sendButton.disabled = false;
	  } else {
	    dataChannelSend.disabled = true;
	    sendButton.disabled = true;
	  }
}

// ICE candidates management
function handleIceCandidate(event) {
  console.log('handleIceCandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate});
  } else {
    console.log('End of candidates.');
  }
}

// Create Offer
function doCall() {
  console.log('Creating Offer...');
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Signalling error handler
function onSignalingError(error) {
	console.log('Failed to create signaling message : ' + error.name);
}

// Create Answer
function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);  
}

// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription); //Esto captura la descripcion local asociada a la conexion, como lo codecs
  sendMessage(sessionDescription);
}

/////////////////////////////////////////////////////////
//AÑADIMOS EL FLUJO DE STREAM DEL OTRO PEER A NUESTRO NAVEGADOR

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  attachMediaStream(remoteVideo, event.stream);
  console.log('Remote stream attached!!.');
  remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}
/////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////
// Clean-up functions...

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();  
  pc = null;
  sendButton.disabled=true;
}

///////////////////////////////////////////
