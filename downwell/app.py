"""Downwell Cloud: private browser-based YouTube downloader."""
from __future__ import annotations
import os, re, secrets, shutil, threading, time, uuid, subprocess
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, urljoin
from flask import Flask, request, jsonify, render_template_string, send_file, abort, redirect, session
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
import yt_dlp

ROOT = Path("/tmp/downwell_jobs")
ROOT.mkdir(parents=True, exist_ok=True)
ACCESS_KEY = os.environ.get("DOWNWELL_ACCESS_KEY", "")
if len(ACCESS_KEY) < 12:
    raise RuntimeError("Set DOWNWELL_ACCESS_KEY to a strong value at least 12 characters long.")
MAX_BYTES = 350 * 1024 * 1024
MAX_DURATION = 2 * 60 * 60
TTL = 40 * 60
HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}
VALID_ID = re.compile(r"^[a-zA-Z0-9_-]{11}$")
QUALITIES = {"fast", "best", "1080", "720", "480", "360"}
# Public extraction alternatives; cloud IP blocks can still affect all of them.
YOUTUBE_CLIENTS = ("web_safari", "android_vr", "web_embedded")
app = Flask(__name__)
app.config.update(SECRET_KEY=os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32),
                  MAX_CONTENT_LENGTH=8192, SESSION_COOKIE_HTTPONLY=True,
                  SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="Lax")
jobs = {}
guard = threading.RLock()
slots = threading.BoundedSemaphore(2)
attempts = {}

STYLE = """
:root {color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
* {box-sizing:border-box} body {margin:0;min-height:100vh;background:#0a0d13;color:#eff4f7;overflow-x:hidden}
body:before {content:'';position:fixed;z-index:-1;top:-250px;left:15%;width:75vw;height:600px;background:radial-gradient(ellipse,#203b2c55,transparent 65%);pointer-events:none}
.wrap {max-width:890px;padding:30px 23px 80px;margin:auto}
nav {display:flex;justify-content:space-between;align-items:center;gap:20px;border-bottom:1px solid #252d33;padding-bottom:23px}
.brand {font-size:28px;font-weight:850;letter-spacing:-1.3px}.brand b{color:#b9fd79}
.pill {border:1px solid #3a4c37;color:#bbf494;background:#b8ff7410;border-radius:99px;padding:8px 13px;font-size:12px;font-weight:650}
h1 {font-size:clamp(43px,7vw,76px);line-height:1.06;letter-spacing:-3px;margin:24px 0 15px}
h1 em {color:#baff82;font-style:normal}
.hero{padding:73px 0 38px}.overline{color:#baff82;letter-spacing:2.5px;font-size:11px;font-weight:780}
.sub{color:#aeb7be;font-size:18px;line-height:1.6;max-width:600px;margin-top:10px}
.panel{border:1px solid #343d42;border-radius:23px;background:linear-gradient(146deg,#181e25,#11151c);padding:29px;box-shadow:0 24px 80px #0007}
.eyebrow {color:#9eacb0;letter-spacing:1.7px;font-weight:760;font-size:11px;margin:0 0 17px}
.urlbox{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
input,select{background:#090e13;color:#f5fcf2;border:1px solid #3d474c;border-radius:13px;font-size:15px;outline:none}
input:focus,select:focus{border-color:#b9ff7a;box-shadow:0 0 0 3px #adfa7b15}
.urlbox input {flex:1;min-width:200px;padding:17px}
button,.action{background:#c0ff86;color:#102014;font-weight:800;border:0;border-radius:12px;padding:17px 20px;cursor:pointer;font-size:14px}
button:hover,.action:hover{filter:brightness(1.08)}button:disabled{opacity:.5;cursor:wait}
.muted{font-size:12px;color:#88959a;margin:13px 0 0}
hr{border:0;border-top:1px solid #2d3539;margin:29px 0}
.preview{display:flex;gap:21px;align-items:center}.thumb{width:210px;max-width:43%;aspect-ratio:16/9;border-radius:12px;object-fit:cover}
.preview h2{font-size:21px;line-height:1.3;margin:4px 0 9px}.preview p{color:#a8b7b9;margin:0;font-size:13px}
.choices{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.choice{background:#11171d;color:#dfe8e6;border:1px solid #445055;min-width:150px}
.choice.active{background:#29452d;border:1px solid #a5ea70;color:#c9ff99}
select{padding:14px 16px;width:min(100%,350px);margin:3px 0 19px}
.primary{width:100%;font-size:16px;margin-top:8px}
.alert{color:#ffd2c8;background:#5a272230;border:1px solid #9e524a;border-radius:12px;padding:15px;margin-top:15px}
.progress{height:11px;border-radius:20px;background:#35413d;overflow:hidden;margin-top:19px}
.bar{height:100%;background:#b9ff7a;width:0%;transition:width .2s ease}
.percent{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-top:15px;color:#bfcacd}
.action{display:block;text-align:center;text-decoration:none;margin-top:18px}
.small{font-size:13px;color:#a1adb4;line-height:1.7}
.footer{display:flex;justify-content:space-between;flex-wrap:wrap;align-items:center;gap:15px;margin-top:36px;color:#809197;font-size:12px}
.ghost{padding:8px 10px;background:none;color:#b3c0bd;border:1px solid #394743;font-size:12px}
[hidden]{display:none!important}
@media(max-width:600px){.panel{padding:22px}.hero{padding-top:46px}h1{letter-spacing:-2px}.preview{align-items:flex-start}.thumb{max-width:38%}}
"""
LOGIN = """<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Downwell | Private Access</title><style>""" + STYLE + """</style></head><body><main class="wrap" style="max-width:520px">
<nav><div class="brand">downwell<b>.</b></div><span class="pill">PRIVATE CLOUD</span></nav>
<div class="hero"><p class="overline">YOUR DOWNLOAD SPACE</p><h1>Welcome <em>back.</em></h1><p class="sub">A clean, private downloader. No ads, no mystery redirects.</p></div>
<div class="panel"><p class="eyebrow">ENTER YOUR ACCESS KEY</p><form action="/login" method="post">
<input type="password" name="password" autocomplete="current-password" required autofocus style="width:100%;padding:16px" placeholder="Access key">
<button type="submit" class="primary">Unlock Downwell →</button></form>
{% if error %}<div class="alert" role="alert">{{ error }}</div>{% endif %}
<p class="muted">Nothing needs to be installed on this computer.</p></div></main></body></html>"""
HOME = """<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0a0d13"><title>Downwell | Personal YouTube Downloader</title><style>""" + STYLE + """</style></head>
<body><main class="wrap">
<nav><div class="brand">downwell<b>.</b></div><span class="pill">● PRIVATE CLOUD</span></nav>
<section class="hero"><p class="overline">✦ THE INTERNET, WITHOUT THE NONSENSE</p>
<h1>Save the good stuff.<br><em>Skip the sketchy sites.</em></h1>
<p class="sub">Your own ad-free YouTube downloader. Paste a link, pick the quality, and save it straight to your browser.</p></section>
<div class="panel">
<p class="eyebrow">01 / PASTE A YOUTUBE LINK</p>
<form id="lookup"><div class="urlbox"><input id="url" type="url" required autocomplete="off" placeholder="https://www.youtube.com/watch?v=..." aria-label="YouTube URL">
<button id="lookupBtn" type="submit">Get video ↗</button></div></form>
<p class="muted">YouTube videos, Shorts, and youtu.be links. No playlists. <a href="/direct" style="color:#baff82;font-weight:700">Having trouble? Use browser-safe mode →</a></p>
<div id="alert" class="alert" role="alert" hidden></div>
<section id="found" hidden><hr><p class="eyebrow">02 / FOUND YOUR VIDEO</p>
<div class="preview"><img id="thumb" class="thumb" alt="YouTube thumbnail"><div><h2 id="title"></h2><p id="channel"></p></div></div>
<hr><p class="eyebrow">03 / CHOOSE FORMAT</p>
<div class="choices"><button type="button" class="choice active" data-kind="video">▣ Video (MP4)</button><button type="button" class="choice" data-kind="audio">♫ Audio (MP3)</button></div>
<label for="quality" class="eyebrow" style="display:block">VIDEO QUALITY</label>
<select id="quality"><option value="best">Best available</option><option value="1080">Up to 1080p (Full HD)</option><option value="720">Up to 720p (HD)</option><option value="480">Up to 480p</option><option value="360">Up to 360p</option></select>
<button id="download" type="button" class="primary">↓ Download to my browser</button>
<p class="muted">Files are processed on your cloud server. Download content you own or have permission to save.</p></section>
<section id="job" hidden><hr><div class="percent"><strong id="status">Preparing...</strong><span id="pct">0%</span></div>
<div class="progress"><div id="bar" class="bar"></div></div><p id="detail" class="small"></p>
<a id="save" class="action" href="#" hidden>↓ Save your file</a></section></div>
<footer class="footer"><span>No ads. No accounts on converter sites. No tracking scripts.</span>
<form action="/logout" method="post"><button type="submit" class="ghost">Sign out</button></form></footer>
</main><script>
const el=id=>document.getElementById(id);
let current=null,kind='video',busy=false,poller=null;
function error(message){const a=el('alert');a.textContent=message;if(/failed to fetch|network|load failed/i.test(message)){a.appendChild(document.createTextNode(' — '));const link=document.createElement('a');link.href='/direct';link.textContent='Use browser-safe mode';link.style.color='#baff82';link.style.fontWeight='700';a.appendChild(link);}a.hidden=false;}
function clearError(){el('alert').hidden=true;el('alert').textContent='';}
async function post(path,obj){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
let d={};try{d=await r.json()}catch(e){}if(!r.ok)throw Error(d.error||'Something went wrong');return d;}
function stop(){if(poller){clearInterval(poller);poller=null;}}
document.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{
kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));
el('quality').disabled=kind==='audio';}));
el('url').addEventListener('input',()=>{current=null;el('found').hidden=true;el('job').hidden=true;stop();clearError();});
el('lookup').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;clearError();stop();el('found').hidden=true;el('job').hidden=true;
el('lookupBtn').disabled=true;el('lookupBtn').textContent='Searching...';
try{const d=await post('/api/info',{url:el('url').value});current=d;el('thumb').src=d.thumbnail;el('title').textContent=d.title;
el('channel').textContent=d.channel+(d.duration?' · '+Math.floor(d.duration/60)+' min':'');el('found').hidden=false;}
catch(e){error(e.message);}finally{busy=false;el('lookupBtn').disabled=false;el('lookupBtn').textContent='Get video ↗';}});
async function status(id){try{const r=await fetch('/api/status/'+encodeURIComponent(id),{cache:'no-store'});const d=await r.json();
if(!r.ok)throw Error(d.error||'Cannot check progress');
el('status').textContent=d.status==='ready'?'Your file is ready!':d.status==='error'?'Download failed':d.status==='processing'?'Finishing file...':'Downloading...';
el('pct').textContent=d.progress==null?'...':Math.round(d.progress)+'%';el('bar').style.width=(d.progress||0)+'%';el('detail').textContent=d.message||'Processing...';
if(d.status==='ready'||d.status==='error'){stop();el('download').disabled=false;
if(d.status==='ready'){el('save').href=d.download_url;el('save').hidden=false;el('save').click();}else error(d.message||'Download failed');}}
catch(e){stop();el('download').disabled=false;error(e.message);}}
el('download').addEventListener('click',async()=>{if(!current||el('download').disabled)return;clearError();stop();
el('job').hidden=false;el('save').hidden=true;el('pct').textContent='0%';el('bar').style.width='0%';el('status').textContent='Connecting...';el('detail').textContent='';
el('download').disabled=true;
try{const d=await post('/api/download',{url:current.url,kind:kind,quality:el('quality').value,title:current.title,client:current.client});
await status(d.job_id);if(poller===null&&el('download').disabled)poller=setInterval(()=>status(d.job_id),1200);}
catch(e){el('download').disabled=false;error(e.message);}});
</script></body></html>"""


# Browsers or privacy extensions sometimes block JS fetch even for the same origin.
# This alternate UI uses only standard HTML form submissions and redirects.
DIRECT = """<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{% if job and job.status not in ('ready','error') %}<meta http-equiv="refresh" content="2">{% endif %}
<title>Downwell | Browser-safe downloader</title><style>""" + STYLE + """</style></head>
<body><main class="wrap" style="max-width:740px">
<nav><div class="brand">downwell<b>.</b></div><span class="pill">BROWSER-SAFE MODE</span></nav>
<section class="hero" style="padding-top:45px"><p class="overline">NO JAVASCRIPT REQUIRED</p>
<h1>Just paste.<br><em>And download.</em></h1>
<p class="sub">This mode uses normal browser pages, not JavaScript requests. Nothing to install.</p></section>
<div class="panel">
{% if not job %}
<form action="/direct/download" method="post">
<div style="padding:15px 18px;border:1px solid #4c6248;background:#baff820b;border-radius:12px;margin-bottom:24px">
<label style="display:flex;gap:10px;align-items:start;font-size:14px;line-height:1.5">
<input type="checkbox" name="relay" value="yes" checked style="margin-top:4px">
<span><strong>Fast + resumable mode (recommended)</strong>
<span style="display:block;color:#abb8ac;margin-top:5px">Downloads in 1 MB pieces with parallel connections and retries. Uses a third-party Invidious relay; your video ID is shared with it. Up to 150 MB.</span></span></label></div>
<p class="eyebrow">YOUTUBE VIDEO OR SHORTS LINK</p>
<input type="url" name="url" required maxlength="2048" autocomplete="off"
placeholder="https://www.youtube.com/watch?v=..." value="{{ form.get('url','') }}"
style="width:100%;padding:16px">
<div class="choices" style="gap:18px">
<label><input type="radio" name="kind" value="video" {% if form.get('kind','video') == 'video' %}checked{% endif %}> MP4 video</label>
<label><input type="radio" name="kind" value="audio" {% if form.get('kind') == 'audio' %}checked{% endif %}> MP3 audio</label>
</div>
<p class="eyebrow">QUALITY</p>
<select name="quality">
<option value="fast">Fast 360p — reliable H.264, smallest file</option>
<option value="720">Up to 720p — sharper video</option>
<option value="480">Up to 480p — H.264 when possible</option>
<option value="360">Up to 360p — smallest file</option>
<option value="1080">Up to 1080p — auto-adjusts for size</option>
<option value="best">Best within relay limit</option></select>
<p class="eyebrow">YOUTUBE CONNECTION</p>
<select name="client">
<option value="web_safari">Default (Safari)</option>
<option value="android_vr">Android alternative</option>
<option value="web_embedded">Embedded alternative</option>
</select>
<button class="primary" type="submit">↓ Start download</button></form>
{% if error %}<div class="alert" role="alert">{{ error }}</div>{% endif %}
<p class="small">This service runs on free hosting and may take about a minute to wake after inactivity. Fast mode depends on a community-operated relay and is not guaranteed for every video.</p>
{% else %}
<p class="eyebrow">DOWNLOAD STATUS</p>
{% if job.status == 'ready' %}
<h2>Ready to save.</h2><p class="small">{{ job.filename }}</p>
<a class="action" href="/api/file/{{ job_id }}">↓ Download file</a>
{% elif job.status == 'error' %}
<h2>Download failed.</h2><div class="alert">{{ job.message }}</div>
{% else %}
<h2>Processing your file...</h2><p class="sub">{{ job.message or 'Preparing...' }}</p>
<p class="small">This page checks progress automatically every four seconds. Don't close it.</p>
{% if job.progress is not none %}<div class="progress"><div class="bar" style="width:{{ job.progress }}%"></div></div>
<p class="muted">{{ job.progress }}%</p>{% endif %}
{% endif %}
{% endif %}
<p style="margin-top:30px"><a href="/direct" style="color:#baff82">← Start a new download</a>
<span style="color:#6e8181"> · </span>
<a href="/classic" style="color:#baff82">Classic interface</a></p>
</div>
<footer class="footer"><span>Private access. No ads or third-party converters.</span></footer>
</main></body></html>"""

@app.get("/direct")
def direct_page():
    return render_template_string(DIRECT,job=None,error=None,form={})

@app.post("/direct/download")
def direct_download():
    form=request.form.to_dict()
    try:
        url,video_id=normal_url(form.get("url"))
        kind=form.get("kind","video")
        quality=form.get("quality","best")
        client=form.get("client","web_safari")
        if kind not in ("video","audio") or quality not in QUALITIES or client not in YOUTUBE_CLIENTS:
            raise ValueError("Unsupported format or connection option.")
    except ValueError as e:
        return render_template_string(DIRECT,job=None,error=str(e),form=form),400
    purge()
    if not slots.acquire(blocking=False):
        return render_template_string(DIRECT,job=None,error="Two downloads are already running. Try again shortly.",form=form),429
    key=uuid.uuid4().hex
    with guard:
        jobs[key]={"created":time.time(),"status":"queued","progress":0,"message":"Preparing..."}
    threading.Thread(target=worker,args=(key,url,kind,quality,video_id,video_id,client,form.get('relay')=='yes'),daemon=True).start()
    return redirect("/direct/status/"+key,code=303)

@app.get("/direct/status/<key>")
def direct_status(key):
    purge()
    with guard:
        job=jobs.get(key)
        job=dict(job) if job else None
    if not job:
        return render_template_string(DIRECT,job=None,error="This download expired or the server restarted. Please try again.",form={}),404
    return render_template_string(DIRECT,job=job,job_id=key,error=None,form={})


def normal_url(value):
    if not isinstance(value,str) or len(value)>2048 or not value.startswith(("https://","http://")):
        raise ValueError("Paste a full YouTube link.")
    u=urlsplit(value.strip());host=(u.hostname or "").lower()
    if host not in HOSTS or u.username or u.password or u.port not in (None,80,443):
        raise ValueError("Only YouTube links are supported.")
    parts=[x for x in u.path.split("/") if x]
    if host in {"youtu.be","www.youtu.be"}:
        video_id=parts[0] if len(parts)==1 else ""
    elif u.path=="/watch":
        video_id=parse_qs(u.query).get("v",[""])[0]
    elif len(parts)==2 and parts[0] in {"shorts","live","embed"}:
        video_id=parts[1]
    else: video_id=""
    if not VALID_ID.fullmatch(video_id):
        raise ValueError("This is not a valid YouTube video or Shorts link.")
    return "https://www.youtube.com/watch?v="+video_id,video_id

def options(client=None):
    result = {"quiet":True,"no_warnings":True,"noplaylist":True,"socket_timeout":25,
              "retries":2,"fragment_retries":2,"extractor_retries":2,
              "js_runtimes":{"deno":{}}}
    if client:
        result["extractor_args"] = {"youtube":{"player_client":[client]}}
    return result

def youtube_blocked(message):
    msg = str(message).lower()
    return ("sign in to confirm" in msg or "not a bot" in msg
            or "login_required" in msg or "http error 403" in msg)

def purge():
    now=time.time()
    with guard:
        old=[key for key,j in jobs.items() if j["status"] in ("ready","error") and now-j["created"]>TTL]
        for key in old: jobs.pop(key,None)
    for key in old:shutil.rmtree(ROOT/key,ignore_errors=True)

def change(key,**kwargs):
    with guard:
        if key in jobs:jobs[key].update(kwargs)

@app.after_request
def headers(response):
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["Referrer-Policy"]="no-referrer"
    response.headers["X-Frame-Options"]="DENY"
    response.headers["Cache-Control"]="no-store"
    return response

@app.before_request
def authorize():
    if request.path=="/api/health" or request.path=="/login":
        return None
    if not session.get("ok"):
        if request.path.startswith("/api/"):return jsonify(error="Sign in first."),401
        return redirect("/login")

@app.route("/login",methods=["GET","POST"])
def login():
    if session.get("ok"):return redirect("/")
    if request.method=="POST":
        addr=request.remote_addr or "unknown";now=time.time()
        with guard:
            records=[t for t in attempts.get(addr,[]) if t>now-120]
            attempts[addr]=records
            if len(records)>12:return render_template_string(LOGIN,error="Too many attempts. Try again later."),429
        provided=request.form.get("password","")
        if secrets.compare_digest(provided.encode(),ACCESS_KEY.encode()):
            session.clear();session["ok"]=True
            return redirect("/")
        with guard:attempts[addr].append(now)
        return render_template_string(LOGIN,error="Incorrect access key."),403
    return render_template_string(LOGIN,error=None)

@app.post("/logout")
def logout():
    session.clear();return redirect("/login")

@app.get("/")
def home():
    return redirect("/direct")

@app.get("/classic")
def classic():
    return render_template_string(HOME)

@app.get("/api/health")
def health():
    return jsonify(ok=True,service="downwell")

def read_json():
    if not request.is_json:abort(415)
    data=request.get_json(silent=True)
    if not isinstance(data,dict):abort(400)
    return data

@app.post("/api/info")
def info():
    purge()
    try:
        url,video_id=normal_url(read_json().get("url"))
    except ValueError as e:
        return jsonify(error=str(e)),400

    # Try multiple public clients without requiring Google session cookies.
    last_error=None
    data=None
    selected=None
    for client in YOUTUBE_CLIENTS:
        try:
            with yt_dlp.YoutubeDL({**options(client),"skip_download":True}) as y:
                data=y.extract_info(url,download=False)
            if data:
                selected=client
                break
        except Exception as e:
            last_error=e
    if not data:
        if last_error and youtube_blocked(last_error):
            return jsonify(error="YouTube is blocking requests from this cloud server, even with alternate public clients. Your Downwell login cannot fix this. Try again later; a different server network may be required."),503
        return jsonify(error="Could not retrieve this video. Check that it is public and available, then try again."),422

    if (data.get("duration") or 0)>MAX_DURATION:
        return jsonify(error="Videos are limited to two hours on the free cloud plan."),400
    app.logger.info("Video metadata succeeded with client %s", selected)
    return jsonify(url=url,title=(data.get("title") or "YouTube video")[:200],
                   channel=(data.get("channel") or data.get("uploader") or "YouTube")[:100],
                   duration=data.get("duration"),client=selected,
                   thumbnail="https://i.ytimg.com/vi/"+video_id+"/hqdefault.jpg")


RELAY_ORIGIN = "https://yt.chocolatemoo53.com"
RELAY_LIMIT = 150 * 1024 * 1024  # Respect community bandwidth and free-tier limits.

def relay_media_url(raw):
    parsed=urlsplit(str(raw))
    if parsed.scheme!="https" or parsed.netloc!="yt.chocolatemoo53.com" or parsed.path!="/videoplayback":
        raise ValueError("The relay provided an invalid media address.")
    return raw


RELAY_CHUNK = 1024 * 1024
RELAY_CONCURRENCY = 3
RELAY_RETRIES = 5
_client_local = threading.local()

def relay_client():
    # One pooled HTTPS session per worker thread; much less connection overhead.
    client=getattr(_client_local,"client",None)
    if client is None:
        client=requests.Session()
        client.headers.update({"User-Agent":"Mozilla/5.0 (compatible; Downwell/1.1)",
                               "Accept-Encoding":"identity"})
        _client_local.client=client
    return client

def verified_relay_url(url):
    parsed=urlsplit(str(url))
    host=(parsed.hostname or "").lower()
    accepted=(host=="yt.chocolatemoo53.com" or
              (host.endswith(".chocolatemoo53.com") and host.startswith("yt-comp")))
    if parsed.scheme!="https" or not accepted or parsed.path!="/videoplayback" or \
       parsed.username or parsed.password or parsed.port not in (None,443):
        raise RuntimeError("The community relay redirected to an unapproved address.")
    return url

def open_relay_stream(url,byte_range=None):
    """Follow redirect only inside trusted relay and companion media hosts."""
    url=verified_relay_url(url)
    headers={"Accept":"*/*"}
    if byte_range is not None:
        start,end=byte_range
        headers["Range"]=f"bytes={start}-{end}"
    for _ in range(5):
        response=relay_client().get(url,headers=headers,timeout=(5,22),allow_redirects=False,stream=True)
        if response.status_code not in (301,302,303,307,308):
            return response
        location=response.headers.get("location","")
        response.close()
        url=verified_relay_url(urljoin(url,location))
    raise RuntimeError("The media relay redirected too many times.")

def resolve_relay_url(raw):
    """Cache a trusted companion link to avoid a redirect on every 1 MB request."""
    url=relay_media_url(raw)
    with relay_client().get(url,headers={"Range":"bytes=0-0"},timeout=(5,15),
                            allow_redirects=False,stream=True) as response:
        if response.status_code in (301,302,303,307,308):
            return verified_relay_url(urljoin(url,response.headers.get("location","")))
        if response.status_code in (200,206):
            return url
        raise RuntimeError("The media relay could not provide a download address (HTTP "
                           +str(response.status_code)+").")

def parallel_relay_download(key,folder,selections,combined_size):
    """Validated HTTP ranges, 3 parallel connections, retries, and no partial chunks."""
    if not combined_size or combined_size>RELAY_LIMIT:
        raise RuntimeError("Video file size is unavailable or exceeds the 150 MB relay limit.")
    jobs_to_fetch=[]
    paths={}
    fds={}
    download_lock=threading.Lock()
    downloaded=[0]
    start_time=time.monotonic()
    try:
        for label,fmt in selections:
            expected=int(fmt.get("clen") or 0)
            if expected<=0 or expected>RELAY_LIMIT:
                raise RuntimeError("Media stream does not expose a safe file size.")
            url=resolve_relay_url(relay_media_url(fmt.get("url")))
            dest=folder/(label+".source")
            with dest.open("wb") as out:
                out.truncate(expected)
            fd=os.open(dest,os.O_WRONLY)
            fds[label]=fd
            paths[label]=dest
            for begin in range(0,expected,RELAY_CHUNK):
                end=min(begin+RELAY_CHUNK,expected)-1
                jobs_to_fetch.append((label,url,relay_media_url(fmt.get("url")),begin,end,expected))
        total_parts=len(jobs_to_fetch)
        completed=[0]

        def fetch_chunk(item):
            label,url,origin_url,begin,end,expected=item
            need=end-begin+1
            last_error="Unknown transfer failure"
            for attempt in range(RELAY_RETRIES):
                try:
                    with open_relay_stream(url,(begin,end)) as remote:
                        if remote.status_code!=206:
                            raise RuntimeError("Relay doesn't support resumable requests (HTTP "
                                               +str(remote.status_code)+").")
                        content_range=remote.headers.get("content-range","").strip()
                        match=re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)",content_range,re.I)
                        if not match or tuple(int(x) for x in match.groups())!=(begin,end,expected):
                            raise RuntimeError("Relay returned an incorrect byte range.")
                        collected=bytearray()
                        for packet in remote.iter_content(chunk_size=128*1024):
                            if not packet:continue
                            collected.extend(packet)
                            if len(collected)>need:raise RuntimeError("Relay returned too many bytes.")
                        if len(collected)!=need:
                            raise RuntimeError(f"Relay stopped early ({len(collected)} of {need} bytes).")
                    written=os.pwrite(fds[label],collected,begin)
                    if written!=need:
                        raise RuntimeError("Couldn't write the complete video segment.")
                    with download_lock:
                        downloaded[0]+=need
                        completed[0]+=1
                        elapsed=max(0.5,time.monotonic()-start_time)
                        speed=(downloaded[0]/(1024*1024))/elapsed
                        change(key,status="downloading",
                          progress=min(94,round(3+downloaded[0]/combined_size*90,1)),
                          message=f"Fast download · {downloaded[0]/(1024*1024):.1f}/{combined_size/(1024*1024):.1f} MB · {speed:.1f} MB/s ({completed[0]}/{total_parts} parts)")
                    return
                except (requests.RequestException,RuntimeError,OSError) as exc:
                    last_error=str(exc)[:130]
                    if attempt+1<RELAY_RETRIES:
                        if "HTTP 403" in str(exc):
                            # Try another signed relay companion on 403.
                            try:url=resolve_relay_url(origin_url)
                            except Exception:pass
                        time.sleep(0.6*(attempt+1))
            raise RuntimeError(f"Couldn't retrieve {label} segment {begin//RELAY_CHUNK+1} after {RELAY_RETRIES} attempts: {last_error}")
        with ThreadPoolExecutor(max_workers=RELAY_CONCURRENCY,thread_name_prefix="range") as pool:
            futures=[pool.submit(fetch_chunk,item) for item in jobs_to_fetch]
            try:
                for future in as_completed(futures):
                    future.result()
            except Exception:
                for future in futures:future.cancel()
                raise
        return paths
    finally:
        for fd in fds.values():
            os.close(fd)


def relay_process(key,folder,video_id,kind,quality,title):
    """Use an explicitly selected open-source public Invidious relay."""
    change(key,status="processing",progress=2,message="Checking trusted community relay...")
    url=RELAY_ORIGIN+"/api/v1/videos/"+video_id+"?local=true"
    response=requests.get(url,timeout=(7,25),allow_redirects=False)
    if response.status_code!=200:
        raise RuntimeError("Community relay metadata unavailable (HTTP "+str(response.status_code)+").")
    if len(response.content)>1400000:
        raise RuntimeError("Community relay response exceeded its safety limit.")
    data=response.json()
    if data.get("videoId")!=video_id or (data.get("lengthSeconds") or 0)>MAX_DURATION:
        raise RuntimeError("Video is unavailable or exceeds the two-hour limit.")
    fmts=data.get("adaptiveFormats") or []
    audios=[f for f in fmts if f.get("itag")=="140" and
            f.get("url","").startswith(RELAY_ORIGIN+"/videoplayback?")]
    if not audios:
        audios=[f for f in fmts if str(f.get("type","")).startswith("audio/") and
                f.get("url","").startswith(RELAY_ORIGIN+"/videoplayback?")]
    if not audios:raise RuntimeError("This relay did not return a usable audio stream.")
    audios.sort(key=lambda f: abs(int(f.get("bitrate") or 128000)-128000))
    audio=audios[0]
    video=None
    if kind=="video":
        max_h = 360 if quality=="fast" else (1080 if quality=="best" else int(quality))
        videos=[f for f in fmts if str(f.get("type","")).startswith("video/mp4") and
                f.get("url","").startswith(RELAY_ORIGIN+"/videoplayback?")]
        def height(f):
            match=re.match(r"^(\d{3,4})p",str(f.get("qualityLabel") or ""))
            return int(match.group(1)) if match else 0
        videos=[f for f in videos if 0<height(f)<=max_h and int(f.get("clen") or 0)>0]
        # Prefer editing-friendly H.264 at each resolution; use compact AV1
        # when Fast was requested or when H.264 exceeds the size cap.
        videos.sort(key=lambda f:(-height(f),0 if "avc1" in f.get("type","") else 1,int(f.get("clen"))))
        audio_size=int(audio.get("clen") or 0)
        video=next((f for f in videos if int(f.get("clen"))+audio_size<=RELAY_LIMIT),None)
        if not video:
            raise RuntimeError("This video exceeds the 150 MB relay limit even in its smallest format. Try MP3.")
        change(key,progress=3,message=f"Selected {video.get('qualityLabel','MP4')} / {int(video.get('clen'))/1048576:.0f} MB picture + {audio_size/1048576:.0f} MB audio — preparing...")
    selections=[("audio",audio)]
    if video:selections.insert(0,("video",video))
    try:combined_size=sum(int(f.get("clen") or 0) for _,f in selections)
    except Exception: combined_size=0
    if combined_size and combined_size>RELAY_LIMIT:
        raise RuntimeError("This video is too large for the community relay. Choose a lower quality.")
    paths=parallel_relay_download(key,folder,selections,combined_size)
    change(key,status="processing",progress=95,message="Converting and preparing your file...")
    if kind=="audio":
        dest=folder/"download.mp3"
        args=["ffmpeg","-y","-loglevel","error","-i",str(paths["audio"]),
              "-vn","-codec:a","libmp3lame","-qscale:a","3",str(dest)]
    else:
        dest=folder/"download.mp4"
        args=["ffmpeg","-y","-loglevel","error","-i",str(paths["video"]),
              "-i",str(paths["audio"]),"-map","0:v:0","-map","1:a:0",
              "-c:v","copy","-c:a","copy","-movflags","+faststart","-shortest",str(dest)]
    subprocess.run(args,check=True,timeout=240,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    if not dest.exists() or dest.stat().st_size<1024:
        raise RuntimeError("Conversion did not produce a file.")
    safe=re.sub(r'[\\/:*?"<>|\x00-\x1f]',"_",data.get("title") or title or video_id).strip(" .")[:95] or video_id
    change(key,status="ready",progress=100,message="Ready to save!",
           path=str(dest),filename=safe+dest.suffix)


def worker(key,url,kind,quality,video_id,title,client,relay=False):
    folder=ROOT/key
    relay_problem=None
    try:
        folder.mkdir(parents=True,exist_ok=False)
        if relay:
            # Render's IP is already blocked by YouTube. Do not waste time retrying
            # the broken direct route after a community-relay failure.
            relay_process(key,folder,video_id,kind,quality,title)
            return
        if kind=="audio":fmt="bestaudio/best"
        elif quality=="best":fmt="bv[ext=mp4]+ba[ext=m4a]/bv+ba/best"
        elif quality=="fast":fmt="bv[height<=360][ext=mp4]+ba[ext=m4a]/bv[height<=360]+ba/b[height<=360]"
        else:
            q=int(quality);fmt="bv[height<="+str(q)+"][ext=mp4]+ba[ext=m4a]/bv[height<="+str(q)+"]+ba/b[height<="+str(q)+"]"
        def hook(data):
            if data.get("status")=="downloading":
                total=data.get("total_bytes") or data.get("total_bytes_estimate") or 0
                done=data.get("downloaded_bytes") or 0
                if done>MAX_BYTES:raise RuntimeError("File is too large for the cloud plan. Try a lower resolution.")
                change(key,status="downloading",progress=round(min(98,100*done/total),1) if total else None,message="Downloading from YouTube...")
            elif data.get("status")=="finished":
                change(key,status="processing",progress=99,message="Converting and preparing your file...")
        def filter_video(info,*,incomplete=False):
            if (info.get("duration") or 0)>MAX_DURATION:return "Video exceeds the two-hour limit."
            return None
        opts={**options(client),"format":fmt,"outtmpl":str(folder/"%(id)s.%(ext)s"),
              "merge_output_format":"mp4","max_filesize":MAX_BYTES,"match_filter":filter_video,
              "progress_hooks":[hook],"concurrent_fragment_downloads":2}
        if kind=="audio":
            opts["postprocessors"]=[{"key":"FFmpegExtractAudio","preferredcodec":"mp3","preferredquality":"192"}]
        with yt_dlp.YoutubeDL(opts) as y:
            result=y.download([url])
            if result:raise RuntimeError("YouTube download did not complete.")
        exts={".mp3"} if kind=="audio" else {".mp4",".webm",".mkv"}
        output=[p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts]
        if not output:raise RuntimeError("Conversion completed without a usable file.")
        target=max(output,key=lambda p:p.stat().st_mtime)
        safe=re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',title or video_id).strip(" .")[:95] or video_id
        change(key,status="ready",progress=100,message="Ready to save",
               path=str(target),filename=safe+target.suffix)
    except Exception as e:
        msg=str(e)
        if youtube_blocked(msg):
            msg="YouTube blocks downloads from this server. Use the fast community relay option instead."
        change(key,status="error",message=msg[:220])
        shutil.rmtree(folder,ignore_errors=True)
    finally:slots.release()

@app.post("/api/download")
def download():
    purge()
    try:
        data=read_json();url,video_id=normal_url(data.get("url"))
        kind=data.get("kind","video");quality=str(data.get("quality","best"))
        client=data.get("client","web_safari")
        if kind not in ("video","audio") or quality not in QUALITIES or client not in YOUTUBE_CLIENTS:
            raise ValueError("Unsupported format, quality or extraction client.")
        title=data.get("title","")
        if not isinstance(title,str):title=""
    except ValueError as e:return jsonify(error=str(e)),400
    if not slots.acquire(blocking=False):return jsonify(error="Two downloads are already running. Please finish one first."),429
    key=uuid.uuid4().hex
    with guard:jobs[key]={"created":time.time(),"status":"queued","progress":0,"message":"Preparing..."}
    threading.Thread(target=worker,args=(key,url,kind,quality,video_id,title[:200],client),daemon=True).start()
    return jsonify(job_id=key),202

@app.get("/api/status/<key>")
def status(key):
    purge()
    with guard:job=jobs.get(key)
    if not job:return jsonify(error="This job expired or doesn't exist."),404
    answer={k:job.get(k) for k in ("status","progress","message")}
    if job["status"]=="ready":answer["download_url"]="/api/file/"+key
    return jsonify(answer)

@app.get("/api/file/<key>")
def file(key):
    purge()
    with guard:job=jobs.get(key)
    if not job or job["status"]!="ready":abort(404)
    path=Path(job["path"])
    if not path.is_file():abort(404)
    return send_file(path,as_attachment=True,download_name=job["filename"],max_age=0)






# Temporary low-bandwidth diagnostic: distinguish relay request count limits
# from unsupported byte offsets on the problematic public video.
def downwell_sequential_range_probe():
    try:
        api=RELAY_ORIGIN+"/api/v1/videos/7_IvsIYlHSg?local=true"
        data=requests.get(api,timeout=(6,18)).json()
        fmt=next(f for f in data["adaptiveFormats"] if str(f.get("itag"))=="134")
        original=fmt["url"]
        signed=resolve_relay_url(original)
        for start in (0,1048576,2097152,3145728):
            time.sleep(2.0)
            with open_relay_stream(signed,(start,start+1023)) as r:
                app.logger.warning("SERIAL_RANGE_TEST byte=%d HTTP=%d range=%s",
                    start,r.status_code,r.headers.get("content-range"))
                if r.status_code==206:
                    payload=next(r.iter_content(chunk_size=1024))
                    app.logger.warning("SERIAL_RANGE_TEST byte=%d got=%d bytes",start,len(payload))
    except Exception as e:
        app.logger.warning("SERIAL_RANGE_TEST_FAIL %s: %s",type(e).__name__,str(e)[:180])

threading.Thread(target=downwell_sequential_range_probe,daemon=True).start()

if __name__=="__main__":
    app.run(host="0.0.0.0",port=int(os.environ.get("PORT","10000")))
