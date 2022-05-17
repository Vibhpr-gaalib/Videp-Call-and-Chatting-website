import * as wss from "./wss.js";
import * as constants from "./constants.js";
import * as ui from "./ui.js";
import * as store from "./store.js";

let connectedUserDetails;
let peerConection;
let dataChannel;

const defaultConstraints = {
  audio: true,
  video: true,
};

const configuration = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:13902", //defing address for the stun server.
    },
  ],
};

export const getLocalPreview = () => {
  navigator.mediaDevices
    .getUserMedia(defaultConstraints)
    .then((stream) => {
      ui.updateLocalVideo(stream);
      ui.showVideoCallButtons()
      store.setCallState(constants.callstate.CALL_AVAILABLE)
      store.setLocalStream(stream);
    })
    .catch((err) => {
      console.log("error occured when trying to get an access to camera");
      console.log(err);
    });
};

const createPeerConnection = () => {
  peerConection = new RTCPeerConnection(configuration);

  dataChannel = peerConection.createDataChannel("chat");

  peerConection.ondatachannel = (event) => {
    const dataChannel = event.channel;

    dataChannel.onopen = () => {
      console.log("peer connection is ready to receive data channel messages");
    };

    dataChannel.onmessage = (event) => {
      console.log("message came from data channel");
      const message = JSON.parse(event.data);
      ui.appendMessage(message);
    };
  };

  peerConection.onicecandidate = (event) => {
    console.log("geeting ice candidates from stun server");
    if (event.candidate) {
      // send our ice candidates to other peer
      wss.sendDataUsingWebRTCSignaling({
        connectedUserSocketId: connectedUserDetails.socketId,
        type: constants.webRTCSignaling.ICE_CANDIDATE,
        candidate: event.candidate,
      });
    }
  };

  peerConection.onconnectionstatechange = (event) => {
    if (peerConection.connectionState === "connected") {
      console.log("succesfully connected with other peer");
    }
  };

  // receiving tracks
  const remoteStream = new MediaStream();
  store.setRemoteStream(remoteStream);
  ui.updateRemoteVideo(remoteStream);

  peerConection.ontrack = (event) => {
    remoteStream.addTrack(event.track); //receving audio and video tracks
  };

  // add our stream to peer connection

  if (
    connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE
  ) {
    const localStream = store.getState().localStream;
    for (const track of localStream.getTracks()) {
      peerConection.addTrack(track, localStream);
    }
  }
};

export const sendMessageUsingDataChannel = (message) => {
  const stringifiedMessage = JSON.stringify(message);
  dataChannel.send(stringifiedMessage);
};

export const sendPreOffer = (callType, calleePersonalCode) => {
  connectedUserDetails = {
    callType,
    socketId: calleePersonalCode,
  };

  if (
    callType === constants.callType.CHAT_PERSONAL_CODE ||
    callType === constants.callType.VIDEO_PERSONAL_CODE
  ) {
    const data = {
      callType,
      calleePersonalCode,
    };
    ui.showCallingDialog(callingDialogRejectCallHandler);
    store.setCallState(constants.callstate.CALL_UNAVAILABLE)
    wss.sendPreOffer(data);
  }
};

export const handlePreOffer = (data) => {
  const { callType, callerSocketId } = data;

  if(!checkCallPossibility()){
      return sendPreOfferAnswer(constants.preOfferAnswer.CALL_UNAVAILABLE)
  }

  connectedUserDetails = {
    socketId: callerSocketId,
    callType,
  };

  store.setCallState(constants.callstate.CALL_UNAVAILABLE)

  
  if (
    callType === constants.callType.CHAT_PERSONAL_CODE ||
    callType === constants.callType.VIDEO_PERSONAL_CODE
  ) {
    console.log("showing call dialog");
    ui.showIncomingCallDialog(callType, acceptCallHandler, rejectCallHandler);
  }
};

const acceptCallHandler = () => {
  console.log("call accepted");
  createPeerConnection();
  sendPreOfferAnswer(constants.preOfferAnswer.CALL_ACCEPTED);
  ui.showCallElements(connectedUserDetails.callType);
};

const rejectCallHandler = () => {
  console.log("call rejected");
  sendPreOfferAnswer();
  sendPreOfferAnswer(constants.preOfferAnswer.CALL_REJECTED);
};

const callingDialogRejectCallHandler = () => {
  console.log("rejecting the call");
};

const sendPreOfferAnswer = (preOfferAnswer) => {
  const data = {
    callerSocketId: connectedUserDetails.socketId,
    preOfferAnswer,
  };
  ui.removeAllDialogs();
  wss.sendPreOfferAnswer(data);
};

export const handlePreOfferAnswer = (data) => {
  const { preOfferAnswer } = data;

  ui.removeAllDialogs();

  if (preOfferAnswer === constants.preOfferAnswer.CALLEE_NOT_FOUND) {
    ui.showInfoDialog(preOfferAnswer);
    setIncommmingCallsAvailable()

    // show dialog that callee has not been found
  }

  if (preOfferAnswer === constants.preOfferAnswer.CALL_UNAVAILABLE) {
    setIncommmingCallsAvailable()
        ui.showInfoDialog(preOfferAnswer);
    // show dialog that callee is not able to connect
  }

  if (preOfferAnswer === constants.preOfferAnswer.CALL_REJECTED) {
    setIncommmingCallsAvailable()
        ui.showInfoDialog(preOfferAnswer);
    // show dialog that call is rejected by the callee
  }

  if (preOfferAnswer === constants.preOfferAnswer.CALL_ACCEPTED) {
    ui.showCallElements(connectedUserDetails.callType);
    createPeerConnection();
    sendWebRTCOffer();
  }
};

const sendWebRTCOffer = async () => {
  const offer = await peerConection.createOffer();
  await peerConection.setLocalDescription(offer);
  wss.sendDataUsingWebRTCSignaling({
    connectedUserSocketId: connectedUserDetails.socketId,
    type: constants.webRTCSignaling.OFFER,
    offer: offer,
  });
};

export const handleWebRTCOffer = async (data) => {
  await peerConection.setRemoteDescription(data.offer);
  const answer = await peerConection.createAnswer();
  await peerConection.setLocalDescription(answer);
  wss.sendDataUsingWebRTCSignaling({
    connectedUserSocketId: connectedUserDetails.socketId,
    type: constants.webRTCSignaling.ANSWER,
    answer: answer,
  });
};

export const handleWebRTCAnswer = async (data) => {
  console.log("handling webRTC Answer");
  await peerConection.setRemoteDescription(data.answer);
};

export const handleWebRTCCandidate = async (data) => {
  console.log("handling incoming webRTC candidates");
  try {
    await peerConection.addIceCandidate(data.candidate);
  } catch (err) {
    console.error(
      "error occured when trying to add received ice candidate",
      err
    );
  }
};

let screenSharingStream;

export const switchBetweenCameraAndScreenSharing = async (
  screenSharingActive
) => {
  if (screenSharingActive) {
    const localStream = store.getState().localStream;  //switch back to camera from screensharing.
    const senders = peerConection.getSenders();

    const sender = senders.find((sender) => {               //replacing local video with camera video
      return sender.track.kind === localStream.getVideoTracks()[0].kind;
    });

    if (sender) {
      sender.replaceTrack(localStream.getVideoTracks()[0]); 
    }

    // stopping screen sharing stream
    store.getState().screenSharingStream.getTracks().forEach((track) => track.stop()); //getting every track and stopping them

    store.setScreenSharingActive(!screenSharingActive);

    ui.updateLocalVideo(localStream);
  } else {
    console.log("switching for screen sharing");
    try {
      screenSharingStream = await navigator.mediaDevices.getDisplayMedia({ //getting access to screensharing media.
        video: true,
      });
      store.setScreenSharingStream(screenSharingStream);

      // replace track which sender is sending with screensharing
      const senders = peerConection.getSenders();

      const sender = senders.find((sender) => {
        return (
          sender.track.kind === screenSharingStream.getVideoTracks()[0].kind
        );
      });

      if (sender) {
        sender.replaceTrack(screenSharingStream.getVideoTracks()[0]); //replaceing sender track
      }

      store.setScreenSharingActive(!screenSharingActive); //updating state in store

      ui.updateLocalVideo(screenSharingStream); //appending screensharing to local video preview
    } catch (err) {
      console.error(
        "error occured when trying to get screen sharing stream",
        err
      );
    }
  }
};


export const handleHangUp = ()=>{
  console.log("hanging up the call")
  const data = {
    connectedUserSocketId: connectedUserDetails.socketId,
  }
  wss.sendUserHangUp(data);
}

export const handleConnectedUserHangedUp = ()=>{
  console.log("User Hanged Up")
  closePeerConnectionAndResetState();
}

const closePeerConnectionAndResetState = ()=>{
      if(peerConection){
          peerConection.close();
          peerConection = null;
      }
    
      //active mic and camera 

      if(connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE || connectedUserDetails.callType === constants.callType.VIDEO_STRANGER){
        store.getState().localStream.getVideoTracks()[0].enabled = true;
        store.getState().localStream.getAudioTracks()[0].enabled = true;
      }
        
      ui.updateUiAfterHangUp(connectedUserDetails.callType);
      setIncommmingCallsAvailable()
      connectedUserDetails = null;
} 

const checkCallPossibility = (callType)=>{
  const callState =  store.getState().callState;
  if(callState === constants.callstate.CALL_AVAILABLE){
    return true;
  }
  if(
    (callType === constants.callType.VIDEO_PERSONAL_CODE || callType === constants.callType.VIDEO_STRANGER)&&
    (callState === constants.callstate.CALL_AVAILABLE_ONLY_CHAT)
    )
    {
      return false
  }
  return false;
}

const setIncommmingCallsAvailable = ()=>{
  const localStream =  store.getState().localStream;
  if(localStream){
    store.setCallState(constants.callstate.CALL_AVAILABLE);
  }else{
    store.setCallState(constants.callstate.CALL_AVAILABLE_ONLY_CHAT);
  }
}