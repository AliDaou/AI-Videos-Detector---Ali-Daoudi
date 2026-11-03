import {
  Output, Input, BlobSource, ALL_FORMATS, Conversion,
  WebMOutputFormat, Mp4OutputFormat, StreamTarget, BufferTarget,
  MediaStreamVideoTrackSource, MediaStreamAudioTrackSource, Quality
} from "https://cdn.jsdelivr.net/npm/mediabunny@1.65.0/+esm";

// Downwell Record v2. Media capture, encoding, remuxing and repair stay on-device.
// No upload endpoints, cookies, analytics, or access to browsing history.
const el = id => document.getElementById(id);
const modes = [...document.querySelectorAll("[data-mode]")];
let mode = "video";
let fileHandle = null;
let active = null;
let saving = false;
let paused = false;
let startTime = 0;
let pausedAt = 0;
let pausedMs = 0;
let clockTimer = null;
let outputUrl = null;
let lastBlob = null;
let lastFilename = "";
let repairUrl = null;
let saveBusy = false;

const show = (msg, error=false) => {
  el("notice").textContent = msg;
  el("notice").classList.toggle("error", error);
};
const repairShow = (msg, error=false) => {
  el("repairStatus").textContent = msg;
  el("repairStatus").classList.toggle("error", error);
};
const fmtTime = n => {
  n = Math.floor(Math.max(0,n));
  return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
};
const bytesText = n => n ? (n/1024/1024).toFixed(1)+" MB" : "0 MB";
const stamp = () => new Date().toISOString().replace(/[:.]/g,"-");
const getExtension = () => mode==="audio" ? "webm" : el("format").value;
function unlock(locked) {
  el("start").disabled = locked;
  el("choose").disabled = locked;
  el("quality").disabled = locked || mode==="audio";
  el("format").disabled = locked || mode==="audio";
  el("mic").disabled = locked;
  modes.forEach(x=>x.disabled=locked);
  el("stop").disabled = !locked;
  el("pause").disabled = !locked;
}
function removeUrl() {
  if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null;}
  el("download").hidden=true;
}
function resetFile(){
  fileHandle=null;
  el("fileStatus").textContent="No save location selected. Choose a file before recording long videos. Otherwise, the recording stays in browser memory until you stop.";
}
function beginTimer(){
  startTime=performance.now();pausedAt=0;pausedMs=0;
  clearInterval(clockTimer);
  clockTimer=setInterval(tick,500);
  tick();
}
function tick(){
  const elapsed=active ? Math.max(0,performance.now()-startTime-pausedMs-(pausedAt?performance.now()-pausedAt:0)) : 0;
  if(active)el("clock").textContent=fmtTime(elapsed/1000);
  if(!active || paused)return;
  const seconds=elapsed/1000;
  const count=active.videoFrames || 0;
  const last=active.lastVideoFrameAt || startTime;
  if(mode==="video" && seconds>9 && (count<3 || performance.now()-last>9000)){
    el("liveTag").textContent="⚠ CHECK VIDEO";
    if(!active.warned) {
      show("Warning: very few video frames are reaching the encoder. The saved file could show a frozen picture. Check that you selected the playing YouTube tab, not the recorder tab. Try a 10-second test first.",true);
      active.warned=true;
    }
  } else if(!active.warned && mode==="video" && count>=3) {
    el("liveTag").textContent="● RECORDING";
  }
  el("bytes").textContent=mode==="video" ? count+" frames" : (active.audioPackets||0)+" audio packets";
}
function stopTracks(current) {
  if(!current)return;
  for(const item of [current.display,current.mic,current.mixed]) {
    try{item?.getTracks().forEach(t=>t.stop());}catch(_){}
  }
  if(current.audioCtx){current.audioCtx.close().catch(()=>{});}
  el("player").srcObject=null;
  el("player").hidden=true;
  el("empty").hidden=false;
  el("preview").classList.remove("live");
  el("liveTag").textContent="STANDBY";
}
function finishButtons(){
  clearInterval(clockTimer);clockTimer=null;
  unlock(false);el("stop").disabled=true;el("pause").disabled=true;
  el("pause").textContent="Ⅱ Pause";
  paused=false;saving=false;
}
function autoDownload(buffer,type,filename){
  removeUrl();
  lastBlob=new Blob([buffer],{type});
  outputUrl=URL.createObjectURL(lastBlob);
  const a=el("download");
  a.href=outputUrl;a.download=filename;a.hidden=false;
  a.click();
  return lastBlob;
}
async function verifyRecording(file,duration,frames){
  try{
    const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const video=await input.getPrimaryVideoTrack();
    const audio=await input.getPrimaryAudioTrack();
    const gotDuration=await input.computeDuration();
    if(mode==="video" && !video){
      show("The file was saved, but no video track could be found. Audio may still be recoverable. Try again using Chrome Tab sharing.",true);
      return;
    }
    if(mode==="video" && frames<3 && duration>5){
      show("Saved, but the recording contains almost no moving video frames. A repair cannot recreate footage that Chrome never captured. Record a short test while the shared YouTube video is playing.",true);
      return;
    }
    if(!Number.isFinite(gotDuration) || gotDuration<1){
      show("Saved, but the recording duration couldn't be verified. Try the Repair tool below.",true);
      return;
    }
    show("Saved and finalized: "+bytesText(file.size)+" · "+fmtTime(gotDuration)+" · "+
         (video?"video":"audio")+" track "+(audio?"+ audio track":"")+
         ". The file now has duration/seek metadata.");
  }catch(e){
    show("File saved, but automatic verification couldn't read it ("+e.message+"). You can try Repair below.",true);
  }
}
async function setMp4Availability(){
  const option=el("format").querySelector('option[value="mp4"]');
  const hasApi=typeof VideoEncoder!=="undefined" && typeof AudioEncoder!=="undefined";
  if(!hasApi){option.disabled=true;el("formatHint").textContent="WebM is available. MP4 needs Chrome's hardware/software WebCodecs encoding support.";return;}
  try{
    const [v,a]=await Promise.all([
      VideoEncoder.isConfigSupported({codec:"avc1.42001f",width:1280,height:720,bitrate:3500000,framerate:30}),
      AudioEncoder.isConfigSupported({codec:"mp4a.40.2",sampleRate:48000,numberOfChannels:2,bitrate:160000})
    ]);
    if(!v.supported||!a.supported){option.disabled=true;el("formatHint").textContent="MP4 encoding isn't available on this computer; WebM will save as a seekable file.";}
    else el("formatHint").textContent="MP4 (H.264/AAC) for editors; seekable WebM (VP8/Opus) for dependable capture. Both finalize duration/index information.";
  }catch(_){option.disabled=true;el("formatHint").textContent="WebM selected for reliable browser capture.";}
}
modes.forEach(button=>button.addEventListener("click",()=>{
  if(active||saving)return;
  mode=button.dataset.mode;
  modes.forEach(x=>x.dataset.active=String(x===button));
  resetFile();
  el("quality").disabled=mode==="audio";
  el("format").disabled=mode==="audio";
  show(mode==="audio"?"Audio-only: select a Chrome tab and enable Share tab audio.":"Video + audio: choose Chrome Tab and enable Share tab audio.");
}));
el("format").addEventListener("change",resetFile);
el("quality").addEventListener("change",resetFile);
el("choose").addEventListener("click",async()=>{
  if(typeof showSaveFilePicker!=="function"){
    show("This browser doesn't support direct file writing. You can still record into memory and save on Stop. Keep recordings short.",true);return;
  }
  const ext=getExtension();
  try{
    fileHandle=await showSaveFilePicker({
      suggestedName:"Downwell-"+stamp()+"."+ext,
      types:[{
        description:ext.toUpperCase()+" recording",
        accept:{[ext==="mp4"?"video/mp4":mode==="audio"?"audio/webm":"video/webm"]:["."+ext]}
      }]
    });
    el("fileStatus").textContent="Saving progressively to: "+fileHandle.name+
      ". A finalized, seekable file will be written when you press Stop.";
    show("Save destination selected. Start, share the playing YouTube tab with its audio, then Stop to finalize.");
  }catch(e){
    if(e.name!=="AbortError")show("Could not choose file: "+e.message,true);
  }
});
async function startRecording(){
  if(active||saving)return;
  if(!navigator.mediaDevices?.getDisplayMedia || typeof VideoEncoder==="undefined"){
    show("This version requires an up-to-date Chrome or Edge browser on HTTPS with WebCodecs enabled.",true);return;
  }
  removeUrl();
  let display=null,microphone=null,audioCtx=null,mixed=null,writable=null;
  el("start").disabled=true;
  try{
    show("Choose Chrome Tab, select the YouTube video tab, and turn on Share tab audio.");
    // User must explicitly choose the tab; sites cannot pick a tab themselves.
    display=await navigator.mediaDevices.getDisplayMedia({
      video:{displaySurface:"browser",frameRate:{ideal:30,max:30}},
      audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},
      surfaceSwitching:"include",systemAudio:"include",selfBrowserSurface:"exclude"
    });
    const videoTrack=display.getVideoTracks()[0];
    const tabAudio=display.getAudioTracks()[0];
    if(!videoTrack)throw new Error("No video track was shared.");
    if(!tabAudio)throw new Error("No sound shared. Select Chrome Tab and enable Share tab audio.");
    videoTrack.contentHint="detail";
    const settings=videoTrack.getSettings();
    if(settings.displaySurface && settings.displaySurface!=="browser"){
      show("A window/screen was shared instead of Chrome Tab. Sound may work but video capture can be unreliable; choose Chrome Tab for your next attempt.",true);
    }
    let audioTrack=tabAudio;
    if(el("mic").checked){
      microphone=await navigator.mediaDevices.getUserMedia({audio:true});
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const destination=audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(new MediaStream([tabAudio])).connect(destination);
      audioCtx.createMediaStreamSource(microphone).connect(destination);
      audioTrack=destination.stream.getAudioTracks()[0];
    }
    const filename=fileHandle?.name || "Downwell-"+stamp()+"."+getExtension();
    if(fileHandle)writable=await fileHandle.createWritable();
    const mp4=(mode==="video" && el("format").value==="mp4");
    const target=writable ? new StreamTarget(writable,{chunked:true}) : new BufferTarget();
    const out=new Output({
      format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target
    });
    const state={
      display,mic:microphone,mixed,audioCtx,output:out,writable,filename,mode,
      videoFrames:0,audioPackets:0,lastVideoFrameAt:performance.now(),warned:false,
      videoSource:null,audioSource:null,started:false,format:mp4?"mp4":"webm"
    };
    if(mode==="video"){
      const q=el("quality").value;
      const bitrate=q==="standard"?2500000:q==="max"?8500000:4500000;
      const videoSource=new MediaStreamVideoTrackSource(videoTrack,{
        codec:mp4?"avc":"vp8",
        quality:new Quality({bitrate}),
        keyFrameInterval:2,
        latencyMode:"realtime",
        onEncodedPacket:()=>{
          state.videoFrames++;
          state.lastVideoFrameAt=performance.now();
        }
      });
      videoSource.errorPromise.catch(e=>{
        if(active===state){show("Video encoder stopped: "+e.message+". Saving the captured portion.",true);stopRecording();}
      });
      state.videoSource=videoSource;
      out.addVideoTrack(videoSource);
    }
    const audioSource=new MediaStreamAudioTrackSource(audioTrack,{
      codec:mp4?"aac":"opus",
      quality:new Quality({bitrate:160000}),
      onEncodedPacket:()=>{state.audioPackets++;}
    });
    audioSource.errorPromise.catch(e=>{
      if(active===state){show("Audio encoder stopped: "+e.message+". Saving the captured portion.",true);stopRecording();}
    });
    state.audioSource=audioSource;
    out.addAudioTrack(audioSource);
    active=state;
    await out.start();
    state.started=true;
    el("player").srcObject=display;el("empty").hidden=true;el("player").hidden=false;
    el("player").play().catch(()=>{});
    videoTrack.onended=()=>{if(active===state)stopRecording();};
    unlock(true);
    beginTimer();
    el("preview").classList.add("live");
    el("liveTag").textContent="● RECORDING";
    el("sound").textContent="Tab audio";
    show("Recording "+(settings.width||"?")+"×"+(settings.height||"?")+
         " screen + tab audio. Play the shared YouTube video. Stop will finalize a seekable file.");
  }catch(e){
    if(display)display.getTracks().forEach(t=>t.stop());
    if(microphone)microphone.getTracks().forEach(t=>t.stop());
    if(audioCtx)audioCtx.close().catch(()=>{});
    if(writable)try{await writable.abort();}catch(_){}
    active=null;finishButtons();
    show(e.name==="NotAllowedError"?"Screen sharing was cancelled or blocked. Start again and select Chrome Tab.":
         "Recording couldn't start: "+(e.message||String(e)),true);
  }
}
async function stopRecording(){
  if(!active||saving)return;
  const state=active;
  saving=true;
  el("stop").disabled=true;el("pause").disabled=true;
  el("liveTag").textContent="FINALIZING";
  show("Finalizing the file and writing duration/seek metadata. Don't close this tab.");
  const elapsed=(performance.now()-startTime-pausedMs-(pausedAt?performance.now()-pausedAt:0))/1000;
  try{
    await state.output.finalize();
    let file;
    if(state.writable){
      file=await fileHandle.getFile();
      el("download").hidden=true;
      show("Saved to "+state.filename+". Checking playable video/audio tracks...");
    }else{
      const buffer=state.output.target.buffer;
      if(!buffer?.byteLength)throw Error("No recording data was produced.");
      file=autoDownload(buffer,state.format==="mp4"?"video/mp4":mode==="audio"?"audio/webm":"video/webm",state.filename);
    }
    if(!state.writable && file.size>120*1024*1024){
      show("Large recording saved. Use Choose where to save for long videos to reduce memory usage.",true);
    }
    await verifyRecording(file,elapsed,state.videoFrames);
    if(state.format==="webm" && state.videoFrames<3 && elapsed>5){
      el("repairStatus").textContent="The file has too few encoded video frames. Repair can fix seeking, but cannot recreate missing motion.";
    }
  }catch(e){
    if(state.writable)try{await state.writable.abort();}catch(_){}
    show("Failed to finalize recording: "+(e.message||String(e)),true);
  }finally{
    stopTracks(state);
    active=null;
    el("sound").textContent="Waiting";
    finishButtons();
  }
}
function pauseRecording(){
  if(!active||saving)return;
  try{
    if(!paused){
      active.videoSource?.pause();active.audioSource.pause();
      paused=true;pausedAt=performance.now();
      el("pause").textContent="▶ Resume";el("liveTag").textContent="PAUSED";
      show("Paused; recording will resume with no timeline gap.");
    }else{
      active.videoSource?.resume();active.audioSource.resume();
      pausedMs+=performance.now()-pausedAt;pausedAt=0;paused=false;
      el("pause").textContent="Ⅱ Pause";el("liveTag").textContent="● RECORDING";
      show("Recording resumed.");
    }
  }catch(e){show("Pause/resume failed: "+e.message,true);}
}
el("start").addEventListener("click",startRecording);
el("stop").addEventListener("click",stopRecording);
el("pause").addEventListener("click",pauseRecording);
el("repairFile").addEventListener("change",()=>{
  const file=el("repairFile").files?.[0];
  el("repairButton").disabled=!file;
  if(file)repairShow("Selected "+file.name+" ("+bytesText(file.size)+"). The file stays on this device.");
});
el("repairButton").addEventListener("click",async()=>{
  const file=el("repairFile").files?.[0];
  if(!file||saveBusy||active)return;
  saveBusy=true;el("repairButton").disabled=true;
  let writable=null;
  try{
    repairShow("Inspecting media tracks and seeking metadata...");
    const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    const video=await input.getPrimaryVideoTrack();
    const audio=await input.getPrimaryAudioTrack();
    if(!video&&!audio)throw Error("No playable audio/video tracks were found in this file.");
    const originalDuration=await input.computeDuration();
    const mp4=/\.mp4$/i.test(file.name);
    const outputName=file.name.replace(/\.(webm|mp4)$/i,"")+"-repaired."+(mp4?"mp4":"webm");
    let target;
    if(typeof showSaveFilePicker==="function"){
      const handle=await showSaveFilePicker({
        suggestedName:outputName,types:[{
          description:mp4?"MP4 video":"WebM video",
          accept:{[mp4?"video/mp4":"video/webm"]:[mp4?".mp4":".webm"]}
        }]
      });
      writable=await handle.createWritable();
      target=new StreamTarget(writable,{chunked:true});
    }else{
      target=new BufferTarget();
    }
    const output=new Output({format:mp4?new Mp4OutputFormat():new WebMOutputFormat(),target});
    const conversion=await Conversion.init({input,output});
    if(!conversion.isValid){
      const discarded=conversion.discardedTracks||[];
      throw Error("This file could not be remuxed with its existing tracks ("+discarded.length+" unsupported tracks).");
    }
    conversion.onProgress=p=>repairShow("Repairing locally: "+Math.round(100*p)+"%. Writing seek points and duration...");
    await conversion.execute();
    if(writable){
      repairShow("Repair completed and saved to "+outputName+". Original file was not changed.");
      writable=null;
    }else{
      if(!output.target.buffer)throw Error("The repaired output file is empty.");
      if(repairUrl)URL.revokeObjectURL(repairUrl);
      repairUrl=URL.createObjectURL(new Blob([output.target.buffer],{type:mp4?"video/mp4":"video/webm"}));
      const a=el("repairDownload");a.href=repairUrl;a.download=outputName;a.hidden=false;
      a.click();
      repairShow("Repair complete. Download started.");
    }
    if(video)repairShow("Indexed file created ("+fmtTime(originalDuration)+"). If the picture was frozen in the original source, remuxing cannot restore frames that were never recorded.");
  }catch(e){
    if(writable)try{await writable.abort();}catch(_){}
    if(e.name==="AbortError")repairShow("Repair cancelled; your original file was not changed.");
    else repairShow("Repair unsuccessful: "+(e.message||String(e))+". Original file was not changed.",true);
  }finally{
    saveBusy=false;el("repairButton").disabled=false;
  }
});
window.addEventListener("beforeunload",event=>{
  if(active||saving){event.preventDefault();event.returnValue="Your recording is still in progress.";}
});
if(!navigator.mediaDevices?.getDisplayMedia || typeof VideoEncoder==="undefined"){
  show("An up-to-date Chrome or Edge browser is required. This browser cannot encode browser-based video.",true);
  el("start").disabled=true;el("choose").disabled=true;
}
setMp4Availability();
