#include "homehub_status.h"

#include "homehub_aws.h"

#include <cJSON.h>
#include <esp_heap_caps.h>
#include <esp_http_server.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <nvs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "homehub_status";
static constexpr size_t kMaxPlanBytes = 4096;
static constexpr size_t kMaxSseClients = 2;
static constexpr char kDefaultPlan[] =
    "{\"version\":1,\"width\":800,\"height\":600,\"rooms\":[],\"sensors\":[]}";

static httpd_handle_t s_server;
static httpd_req_t *s_sse_reqs[kMaxSseClients];
static portMUX_TYPE s_sse_lock = portMUX_INITIALIZER_UNLOCKED;
static portMUX_TYPE s_plan_lock = portMUX_INITIALIZER_UNLOCKED;
static char *s_plan;
static char s_token[33];
static homehub_status_command_handler_t s_command_handler;

static const char kIndexHtml[] = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store">
<title>HomeHub Local</title><style>
*{box-sizing:border-box}
body{margin:0;padding:16px 18px 24px;background:#fff;color:#000;font-family:Helvetica,Arial,sans-serif}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
#homes{display:flex;align-items:center;flex-wrap:wrap;font-size:18px;font-weight:700;letter-spacing:-0.02em}
#homes>button,#names,#grid{border:0;background:transparent;padding:0;font:inherit;color:#777}
#homes>button.on,#names.on,#grid.on{color:#000}
#homes span.sep{margin:0 8px;color:#777}
#toggles{display:flex;align-items:center;gap:16px;margin-left:auto}
#names,#grid{position:relative;width:22px;height:22px;font-size:16px;font-weight:700;line-height:22px;text-align:center}
#names.off::after,#grid.off::after{content:"";position:absolute;left:2px;right:2px;top:50%;border-top:2px solid currentColor;transform:rotate(-32deg)}
.chips{display:inline-flex;align-items:center;gap:4px;margin:0 2px 0 8px}
.chip{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #111;background:#fff;color:#111;padding:0;font:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer}
.chip.on{background:#111;color:#fff}
.chip svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.chip svg .filled{fill:currentColor}
.grid-line{stroke:#bbb;stroke-width:0.55}
.grid-line.major{stroke:#888;stroke-width:0.85}
.grid-label{font-size:10px;fill:#666;text-anchor:middle}
.grid-label.row{text-anchor:start}
#plan-row{display:flex;flex-direction:column;align-items:stretch}
#plan{display:block;width:100%;height:auto;margin:10px 0 6px;touch-action:pan-y}
.room{fill:#fff;stroke:#000;stroke-width:3}
.room-name{font-size:16px;font-weight:700;text-anchor:middle;fill:#b0b0b0}
.climate{font-size:15px;font-weight:700;text-anchor:middle;fill:#000}
.door,.window{stroke:#000;stroke-width:2.4;fill:none}
.door-swing{stroke:#000;stroke-width:1.4;stroke-dasharray:3 3;fill:none}
.icon{fill:none;stroke:#000;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.icon .filled{fill:#000}
.icon.dead{opacity:.4}
#devices{display:block}
.device-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:28px}
.device-phone{display:none}
.device-col,.device-group{min-width:0}
.device{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px 12px;border-bottom:1px solid #000;padding:10px 2px}
.device.stale{opacity:.45}
.device small{display:block;color:#444;font-size:12px}
.battery,.device small.battery{display:inline-flex;align-items:center;gap:3px}
.battery svg{width:16px;height:10px;fill:none;stroke:currentColor;stroke-width:1.2}
.battery .battery-fill{fill:currentColor;stroke:none}
.reading>small.battery{gap:6px}
.reading-detail .battery{margin-left:6px}
.battery.low{color:#b42318;font-weight:700}
.device-end{display:flex;align-items:center;gap:8px}
.reading{display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1.2}
.reading small{display:block;color:#444;font-size:12px;font-weight:400}
button.ctl{font:inherit;padding:6px 10px;border:1px solid #000;background:#fff;color:#000}
button.ctl.on{background:#000;color:#fff}
.sw{position:relative;display:inline-block;width:74px;height:34px;border:0;border-radius:999px;background:#d8d8d8;padding:0;vertical-align:middle;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.sw.on{background:#000}
.sw.scene{width:102px}
.sw.dead{opacity:.45;cursor:default}
.sw-lab{position:absolute;top:0;bottom:0;display:flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.04em;pointer-events:none}
.sw-lab.on{left:11px;color:#fff;opacity:0}
.sw-lab.off{right:10px;color:#000;opacity:1}
.sw.on .sw-lab.on{opacity:1}
.sw.on .sw-lab.off{opacity:0}
.sw-knob{position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:left .16s ease}
.sw.on .sw-knob{left:calc(100% - 31px)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:0;background:transparent;padding:0;color:#000;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.icon-btn svg{display:block;width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.light-ctl{display:flex;flex-wrap:nowrap;align-items:center;gap:8px}
.light-ctl label{display:flex;align-items:center;gap:6px;font-size:.85rem}
.light-ctl input[type=range]{width:110px}
button.device{position:relative;width:100%;border-left:0;border-right:0;border-top:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.hour-dots{position:absolute;left:2px;right:2px;bottom:2px;display:flex;align-items:center;gap:1px;pointer-events:none}
.hour-dots .hour-gap{flex:0 0 4px;width:4px;height:3px}
.hour-dots i{display:block;width:3px;height:3px;flex:0 0 3px;background:#d0d0d0}
.hour-dots i.on{background:#000}
.sensor-tap{cursor:pointer}
#history{display:none;position:fixed;inset:0;z-index:20;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45);padding:18px 12px}
#history.show{display:flex}
.history-card{width:100%;max-width:560px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #000;padding:14px 16px 18px}
.history-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
.history-head strong{font-size:18px}
.history-actions{display:flex;align-items:center}
.history-close{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;background:transparent;padding:0;color:#000;cursor:pointer}
.history-close svg{display:block;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.history-day + .history-day{margin-top:14px}
.history-day-label{margin:0 0 2px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#444}
.history-row{display:grid;grid-template-columns:minmax(0,1fr) 7.6ch 8.8ch;gap:10px;align-items:baseline;border-bottom:1px solid #000;padding:8px 0;font-size:15px}
.history-row .h-place{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-row .h-time,.history-row .h-value{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.history-row .h-value{font-weight:700}
.history-empty{margin:12px 0 0;color:#444}
@media(max-width:720px){
 body{padding:10px 12px 20px}
 #homes{font-size:16px}
 #toggles{gap:12px}
 #names,#grid{font-size:15px}
 #plan{margin:8px 0 4px}
 .device-cols{display:none}
 .device-phone{display:flex;flex-direction:column}
 .device-group.pair{display:grid;grid-template-columns:1fr 1fr;column-gap:12px}
 .device-group.pair .device>span:first-child{min-width:0}
 .device-group.pair .device small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .device{padding:8px 0}
 .chip{width:24px;height:24px}
 .device.light .light-ctl{gap:5px}
 .device.light .light-ctl label{gap:3px;font-size:11px}
 .device.light .light-ctl input[type=range]{width:42px}
 .device.light .sw{width:46px;height:25px}
 .device.light .sw-lab{font-size:8px}
 .device.light .sw-lab.on{left:6px}
 .device.light .sw-lab.off{right:5px}
 .device.light .sw-knob{top:2px;left:2px;width:20px;height:20px}
 .device.light .sw.on .sw-knob{left:calc(100% - 22px)}
 .light-ctl input[type=range]{width:72px}
 .sw{width:68px;height:32px}
 .sw-knob{width:26px;height:26px}
 .sw.on .sw-knob{left:calc(100% - 29px)}
}
@media(max-width:400px){
 .light-ctl input[type=range]{width:56px}
 .sw-lab{font-size:10px}
}
</style></head><body>
<header>
 <nav id="homes"></nav>
 <div id="toggles">
  <button type="button" id="names" class="on" onclick="toggleNames()" aria-label="Names on">N</button>
  <button type="button" id="grid" class="off" onclick="toggleGrid()" aria-label="Grid off">G</button>
 </div>
</header>
<div id="plan-row">
 <svg id="plan" viewBox="0 0 700 400"></svg>
</div>
<section id="devices"></section>
<div id="history" onclick="if(event.target.id==='history')closeHistory()">
 <div class="history-card">
  <div class="history-head"><strong id="history-kind">Contact</strong><div class="history-actions"><button type="button" class="history-close" aria-label="Close" onclick="closeHistory()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
  <div id="history-rows"></div>
 </div>
</div>
<script>
var HOMES=[{"id":"sample-home-a","name":"Home A","width":800,"height":520,"rooms":[{"id":"living","name":"Living","x":40,"y":40,"w":360,"h":240},{"id":"kitchen","name":"Kitchen","x":400,"y":40,"w":360,"h":240},{"id":"hall","name":"Hall","x":40,"y":280,"w":360,"h":80},{"id":"bed-1","name":"Bedroom 1","x":40,"y":360,"w":240,"h":120},{"id":"bed-2","name":"Bedroom 2","x":280,"y":360,"w":240,"h":120},{"id":"bath","name":"Bathroom","x":520,"y":280,"w":240,"h":200}],"sensors":[],"doors":[],"windows":[]}];
var DEFAULT_ID='sample-home-a';
var CELL=50;
var state={}, token='', activeId=DEFAULT_ID, showNames=true, showGrid=false, lastLux={}, historyId='', historyKind='', historyById={}, historySig='', historyPulling=false;
try{var storedHome=localStorage.getItem('hh.home');if(storedHome)activeId=storedHome;}catch(e){}
try{showNames=localStorage.getItem('hh.names')!=='0';}catch(e){}
try{showGrid=localStorage.getItem('hh.grid')==='1';}catch(e){}
function hasHome(id){for(var i=0;i<HOMES.length;i++)if(HOMES[i].id===id)return true;return false;}
if(!hasHome(activeId))activeId=DEFAULT_ID;
function esc(s){
 s=s==null?'':String(s);
 return s.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function home(){for(var i=0;i<HOMES.length;i++)if(HOMES[i].id===activeId)return HOMES[i];return HOMES[0];}
function pick(id){activeId=id;try{localStorage.setItem('hh.home',id);}catch(e){}drawHomes();render();}
function toggleNames(){showNames=!showNames;try{localStorage.setItem('hh.names',showNames?'1':'0');}catch(e){}drawToggles();render();}
function toggleGrid(){showGrid=!showGrid;try{localStorage.setItem('hh.grid',showGrid?'1':'0');}catch(e){}drawToggles();render();}
function anyOn(list){
 list=list||[];
 for(var i=0;i<list.length;i++)if(list[i].on)return true;
 return false;
}
function modeChips(){
 var home=(state.scene||'home')!=='away';
 var lights=anyOn(state.lights);
 var plugs=anyOn(state.plugs);
 return '<span class="chips" role="group" aria-label="House mode">'+
  '<button type="button" class="chip'+(home?' on':'')+'" role="radio" aria-checked="'+(home?'true':'false')+'" aria-label="Home" title="Home" onclick="setScene(\'home\')">H</button>'+
  '<button type="button" class="chip'+(home?'':' on')+'" role="radio" aria-checked="'+(home?'false':'true')+'" aria-label="Away" title="Away" onclick="setScene(\'away\')">A</button>'+
  '<button type="button" class="chip'+(lights?' on':'')+'" aria-pressed="'+(lights?'true':'false')+'" aria-label="Lights off" title="Lights off" onclick="postCommand(\'all-lights-off\')"><svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="5.5"'+(lights?' class="filled"':'')+'/><path d="M10 16.4h4v2.8h-4z"'+(lights?' class="filled"':'')+'/>'+(lights?'':'<path d="M5 5l14 14"/>')+'</svg></button>'+
  '<button type="button" class="chip'+(plugs?' on':'')+'" aria-pressed="'+(plugs?'true':'false')+'" aria-label="Plugs off" title="Plugs off" onclick="postCommand(\'all-plugs-off\')"><svg viewBox="0 0 24 24"><rect x="7.2" y="10" width="9.6" height="7.2" rx="1.4"'+(plugs?' class="filled"':'')+'/><path d="M10.2 10V5.4M13.8 10V5.4"/><path d="M11 17.2v2.6h2v-2.6"'+(plugs?' class="filled"':'')+'/>'+(plugs?'':'<path d="M5 5l14 14"/>')+'</svg></button>'+
 '</span>';
}
function drawHomes(){
 var html='', i, p;
 for(i=0;i<HOMES.length;i++){
  p=HOMES[i];
  html+=(i?'<span class="sep">/</span>':'')+'<button type="button" class="'+(p.id===activeId?'on':'')+'" onclick="pick(\''+p.id+'\')">'+esc(p.name)+'</button>';
  if(p.id===activeId)html+=modeChips();
 }
 document.getElementById('homes').innerHTML=html;
}
function drawToggles(){
 var names=document.getElementById('names');
 var grid=document.getElementById('grid');
 if(names){names.className=showNames?'on':'off';names.textContent='N';names.setAttribute('aria-label',showNames?'Names on':'Names off');}
 if(grid){grid.className=showGrid?'on':'off';grid.textContent='G';grid.setAttribute('aria-label',showGrid?'Grid on':'Grid off');}
}
function all(){
 var out=[], groups=[['light',state.lights||[]],['plug',state.plugs||[]],['contact',state.contacts||[]],['motion',state.motions||[]],['leak',state.leaks||[]],['climate',state.climates||[]]];
 for(var g=0;g<groups.length;g++){
  var kind=groups[g][0], items=groups[g][1];
  for(var i=0;i<items.length;i++){
   var item=items[i], copy={}, k;
   for(k in item)if(Object.prototype.hasOwnProperty.call(item,k))copy[k]=item[k];
   copy.kind=kind;
   out.push(copy);
  }
 }
 return out;
}
function finite(n){return typeof n==='number'&&isFinite(n);}
function climateLines(d){
 var parts=[];
 if(!d)return ['—'];
 if(finite(d.temperature)&&finite(d.humidity))parts.push(Math.round(d.temperature)+'°/'+Math.round(d.humidity)+'%');
 if(finite(d.co2))parts.push(String(Math.round(d.co2)));
 if(finite(d.pm25))parts.push(String(Math.round(d.pm25)));
 var aq=['','Good','Fair','Moderate','Poor','Very poor','Extreme'];
 if(finite(d.airQuality)&&aq[d.airQuality])parts.push(aq[d.airQuality]);
 if(!parts.length)parts.push('—');
 if(parts.length===1)return parts;
 return [parts[0], parts.slice(1).join(' · ')];
}
function climateText(d){return climateLines(d).join(' · ');}
function climateSvg(d){
 var lines=climateLines(d), i, html='<text class="climate">';
 for(i=0;i<lines.length;i++){
  html+='<tspan x="0" dy="'+(i===0?'10':'18')+'">'+esc(lines[i])+'</tspan>';
 }
 return html+'</text>';
}
function isDead(d){return !!(d&&d.reachable===false);}
function isStale(d){return !!(d&&d.stale===true);}
function headline(d){
 if(isDead(d)&&(d.kind==='light'||d.kind==='plug'))return 'No power';
 if(d.kind==='light')return d.on?('ON '+Math.round(Number(d.brightness)||0)+'%'):'OFF';
 if(d.kind==='plug')return d.on?'ON':'OFF';
 if(d.kind==='contact'||d.kind==='leak'||d.kind==='lock')return d.state||'—';
 if(d.kind==='motion')return d.state||'—';
 var lines=climateLines(d);
 return lines[0]||'—';
}
function motionLux(d){
 var lux=Number(d&&d.lux);
 if(!finite(lux)&&state.readings){
  for(var i=0;i<state.readings.length;i++){
   var r=state.readings[i], metrics=r&&r.metrics;
   if(r&&r.deviceId===d.id&&metrics&&finite(Number(metrics.lightLux))){lux=Number(metrics.lightLux);break;}
  }
 }
 if(finite(lux)){lastLux[d.id]=lux;return lux;}
 return finite(lastLux[d.id])?lastLux[d.id]:NaN;
}
function batteryPercent(d){
 if(!d||!d.id||!state.readings)return NaN;
 for(var i=0;i<state.readings.length;i++){
  var r=state.readings[i], metrics=r&&r.metrics, battery=Number(metrics&&metrics.batteryPercent);
  if(r&&r.deviceId===d.id&&finite(battery))return Math.max(0,Math.min(100,battery));
 }
 return NaN;
}
function detail(d){
 if(d.kind==='motion'){
  var lux=motionLux(d);
  return finite(lux)?(Math.round(lux)+' lx'):'';
 }
 if(isClimate(d.kind)){var extra=climateLines(d);return extra.length>1?extra[1]:'';}
 return '';
}
function value(d){
 var extra=detail(d);
 return extra?headline(d)+' · '+extra:headline(d);
}
function getJson(url,ok,fail){
 var x=new XMLHttpRequest();
 x.open('GET',url,true);
 x.timeout=8000;
 x.onreadystatechange=function(){
  if(x.readyState!==4)return;
  if(x.status>=200&&x.status<300){try{ok(JSON.parse(x.responseText));}catch(e){if(fail)fail();}}
  else if(fail)fail();
 };
 x.onerror=function(){if(fail)fail();};
 x.ontimeout=function(){if(fail)fail();};
 try{x.send();}catch(e){if(fail)fail();}
}
function postJson(url,body,fail){
 var x=new XMLHttpRequest();
 x.open('POST',url,true);
 x.setRequestHeader('Content-Type','application/json');
 if(token)x.setRequestHeader('X-HomeHub-Token',token);
 x.onreadystatechange=function(){
  if(x.readyState!==4)return;
  if(!(x.status>=200&&x.status<300)&&fail)fail(x.status);
 };
 try{x.send(JSON.stringify(body));}catch(e){if(fail)fail();}
}
function ensureToken(done){
 if(token){if(done)done();return;}
 getJson('/auth',function(a){if(a&&a.token)token=a.token;if(done)done();},function(){if(done)done();});
}
function postLight(body){
 ensureToken(function(){
  postJson('/light',body,function(status){mark(false,'LIGHT '+status);});
 });
}
function findLight(id){
 var lights=state.lights||[], i;
 for(i=0;i<lights.length;i++)if(lights[i].id===id)return lights[i];
 return null;
}
function drawModes(){
 drawHomes();
}
function toggleScene(){
 setScene((state.scene||'home')==='away'?'home':'away');
}
function postCommand(command){
 ensureToken(function(){
  postJson('/scene',{command:command},function(status){mark(false,'SCENE '+status);});
 });
}
function setScene(name){
 if(name!=='home'&&name!=='away')return;
 state.scene=name;
 drawModes();
 ensureToken(function(){
  postJson('/scene',{scene:name},function(status){mark(false,'SCENE '+status);});
 });
}
function light(id,on){
 var item=findLight(id);
 if(item){item.on=on;if(on&&!item.brightness)item.brightness=100;render();}
 postLight({id:id,on:on});
}
function setBrightness(id,percent){
 var bri=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));
 var item=findLight(id);
 if(item){item.brightness=bri;item.on=bri>0;render();}
 postLight({id:id,brightness:bri});
}
function postPlug(body){
 ensureToken(function(){
  postJson('/plug',body,function(status){mark(false,'PLUG '+status);});
 });
}
function plug(id,on){
 var plugs=state.plugs||[], item=null, i;
 for(i=0;i<plugs.length;i++)if(plugs[i].id===id)item=plugs[i];
 if(item){item.on=on;render();}
 postPlug({id:id,on:on});
}
function onOffButtons(onClick,offClick,isOn,dead){
 var click=isOn?offClick:onClick;
 return '<button type="button" class="sw'+(isOn?' on':'')+(dead?' dead':'')+'" role="switch" aria-checked="'+(isOn?'true':'false')+'"'+(dead?' disabled':' onclick="'+click+'"')+'><span class="sw-lab on">ON</span><span class="sw-lab off">OFF</span><span class="sw-knob"></span></button>';
}
function plugControls(d){
 return '<span class="light-ctl">'+onOffButtons('plug(\''+d.id+'\',true)','plug(\''+d.id+'\',false)',!!d.on,isDead(d))+'</span>';
}
function invertContact(){
 var c=(state.contacts||[])[0];if(!c)return;
 c.inverted=!c.inverted;c.state=c.state==='OPEN'?'CLOSED':'OPEN';render();
 ensureToken(function(){
  postJson('/contact',{invert:!!c.inverted},function(status){mark(false,'CONTACT '+status);});
 });
}
function lightControls(d){
 var bri=Math.max(0,Math.min(100,Math.round(Number(d.brightness)||0)));
 var id=esc(d.id);
 return '<span class="light-ctl"><label><span>'+bri+'%</span><input type="range" min="0" max="100" step="1" value="'+bri+'" oninput="this.previousElementSibling.innerHTML=this.value+\'%\'" onchange="setBrightness(\''+id+'\',this.value)"></label>'+onOffButtons('light(\''+id+'\',true)','light(\''+id+'\',false)',!!d.on,isDead(d))+'</span>';
}
function isClimate(kind){return kind==='climate'||kind==='co2'||kind==='pm25'||kind==='air-quality';}
function kindLabel(d){
 var name=d&&d.name?String(d.name).toUpperCase():'';
 if(d.kind==='light')return 'Light';
 if(d.kind==='plug')return 'Plug';
 if(d.kind==='contact')return 'Contact';
 if(d.kind==='motion')return 'Motion';
 if(d.kind==='leak')return 'Leak';
 if(d.kind==='lock')return 'Lock';
 if(isClimate(d.kind))return name.indexOf('TIMMERFLOTTE')>=0?'Temp/Humidity':'Environmental';
 return d.kind||'';
}
function sortDevices(list){
 return list.slice().sort(function(a,b){
  var la=kindLabel(a).toLowerCase(), lb=kindLabel(b).toLowerCase();
  if(la<lb)return -1;if(la>lb)return 1;
  var na=devicePlace(a).toLowerCase(), nb=devicePlace(b).toLowerCase();
  if(na<nb)return -1;if(na>nb)return 1;
  return 0;
 });
}
function colLabel(n){
 var label='', i=Math.max(0,Math.floor(n));
 while(i>=0){label=String.fromCharCode(65+(i%26))+label;i=Math.floor(i/26)-1;}
 return label;
}
function gridRef(x,y){
 return colLabel(Math.max(0,Math.floor(Number(x)/CELL)))+(Math.max(0,Math.floor(Number(y)/CELL))+1);
}
function pointInRoom(x,y,r){
 var pts=r.points;
 if(!pts||pts.length<3){
  return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
 }
 var inside=false, i, j=pts.length-1;
 for(i=0;i<pts.length;j=i++){
  var ci=pts[i], lj=pts[j];
  if((ci.y>y)!==(lj.y>y)&&x<((lj.x-ci.x)*(y-ci.y))/(lj.y-ci.y||1)+ci.x)inside=!inside;
 }
 return inside;
}
function roomAt(plan,x,y){
 var rooms=plan.rooms||[], hits=[], i;
 for(i=0;i<rooms.length;i++)if(pointInRoom(x,y,rooms[i]))hits.push(rooms[i]);
 hits.sort(function(a,b){return (a.w*a.h)-(b.w*b.h);});
 return hits[0]||null;
}
function markForDevice(plan,d){
 var sensors=plan.sensors||[], i;
 if(!d||!d.id)return null;
 for(i=0;i<sensors.length;i++)if(sensors[i].deviceId===d.id)return sensors[i];
 return null;
}
function devicePlace(d){
 var plan=home(), s=markForDevice(plan,d);
 if(!s)return '';
 var room=roomAt(plan,s.x,s.y);
 var ref=gridRef(s.x,s.y);
 return room&&room.name?ref+'-'+room.name:ref;
}
function hasHistory(d){return d&&(d.kind==='contact'||d.kind==='motion'||d.kind==='leak');}
function historyTitle(kind){
 if(kind==='contact')return 'Contact';
 if(kind==='motion')return 'Motion';
 if(kind==='leak')return 'Leak';
 return kind||'';
}
function loggedHistoryValue(kind){
 if(kind==='contact')return 'OPEN';
 if(kind==='motion')return 'DETECTED';
 return 'LEAK';
}
function filterHistoryEvents(events,kind){
 var want=loggedHistoryValue(kind), out=[], i;
 events=events||[];
 for(i=0;i<events.length;i++)if(events[i].value===want)out.push(events[i]);
 return out;
}
function historyEmpty(kind){
 if(kind==='motion')return 'No detected events.';
 if(kind==='leak')return 'No leak events.';
 return 'No open events.';
}
function historyValueLabel(value){
 if(value==='OPEN')return 'Open';
 if(value==='DETECTED')return 'Detected';
 if(value==='LEAK')return 'Leak';
 return value;
}
function historyPlace(id){
 var place=devicePlace({id:id});
 if(place)return place;
 var sensors=home().sensors||[], i;
 for(i=0;i<sensors.length;i++)if(sensors[i].deviceId===id)return sensors[i].label||'';
 return '';
}
function historyClock(iso){
 var d=new Date(iso);
 if(isNaN(d.getTime()))return iso||'';
 function pad(n){return (n<10?'0':'')+n;}
 return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
}
function historyDate(iso){
 var d=new Date(iso), months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 if(isNaN(d.getTime()))return iso||'';
 return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}
function historyDayKey(iso){
 var d=new Date(iso);
 if(isNaN(d.getTime()))return '';
 return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}
function rememberHistory(x,id){
 if(!x)return;
 if(id&&x.events){historyById[id]=x.events;return;}
 var devices=x.devices;
 if(devices){
  for(var key in devices){
   if(Object.prototype.hasOwnProperty.call(devices,key)&&devices[key]&&devices[key].events){
    historyById[key]=devices[key].events;
   }
  }
 }
}
function hourActive(value){
 return value==='OPEN'||value==='DETECTED'||value==='LEAK';
}
function hourFilled(id){
 var filled=[], events=historyById[id]||[], now=new Date(), i;
 for(i=0;i<24;i++)filled[i]=false;
 for(i=0;i<events.length;i++){
  if(!hourActive(events[i].value))continue;
  var d=new Date(events[i].at);
  if(isNaN(d.getTime()))continue;
  if(d.getFullYear()!==now.getFullYear()||d.getMonth()!==now.getMonth()||d.getDate()!==now.getDate())continue;
  filled[d.getHours()]=true;
 }
 return filled;
}
function hourDotsHtml(id){
 var filled=hourFilled(id), html='<span class="hour-dots" aria-hidden="true">', i;
 for(i=0;i<24;i++){
  if(i&&i%6===0)html+='<span class="hour-gap"></span>';
  html+='<i class="'+(filled[i]?'on':'')+'"></i>';
 }
 return html+'</span>';
}
function sensorHistorySig(){
 function part(list){
  list=list||[];
  var out='', i;
  for(i=0;i<list.length;i++)out+=(list[i].id||'')+':'+(list[i].state||'')+';';
  return out;
 }
 return part(state.contacts)+'|'+part(state.motions)+'|'+part(state.leaks);
}
function pullHistory(force){
 var sig=sensorHistorySig();
 if(!force&&sig===historySig)return;
 if(historyPulling)return;
 historyPulling=true;
 getJson('/history',function(x){
  historyPulling=false;
  historySig=sig;
  rememberHistory(x);
  render();
  if(historyId)fillHistorySheet(historyId,historyKind);
 },function(){historyPulling=false;});
}
function closeHistory(){
 historyId='';
 historyKind='';
 var el=document.getElementById('history');
 if(el)el.className='';
}
function fillHistorySheet(id,kind){
 var nextKind=historyKind||kind;
 var events=filterHistoryEvents(historyById[id]||[],nextKind), place=historyPlace(id), html='', i, lastDay='';
 var kindEl=document.getElementById('history-kind');
 if(kindEl)kindEl.textContent=historyTitle(nextKind);
 for(i=0;i<events.length;i++){
  var day=historyDayKey(events[i].at);
  if(day!==lastDay){
   if(lastDay)html+='</div>';
   html+='<div class="history-day"><p class="history-day-label">'+esc(historyDate(events[i].at))+'</p>';
   lastDay=day;
  }
  html+='<div class="history-row"><span class="h-place">'+esc(place)+'</span><span class="h-time">'+esc(historyClock(events[i].at))+'</span><strong class="h-value">'+esc(historyValueLabel(events[i].value))+'</strong></div>';
 }
 if(lastDay)html+='</div>';
 var rows=document.getElementById('history-rows');
 if(rows)rows.innerHTML=html||'<p class="history-empty">'+historyEmpty(nextKind)+'</p>';
}
function openHistory(id,kind){
 if(!id)return;
 historyId=id;
 historyKind=kind||'';
 var kindEl=document.getElementById('history-kind');
 var rows=document.getElementById('history-rows');
 var el=document.getElementById('history');
 if(kindEl)kindEl.textContent=historyTitle(kind);
 if(rows)rows.innerHTML=historyById[id]?'':'<p class="history-empty">Loading…</p>';
 if(el)el.className='show';
 if(historyById[id])fillHistorySheet(id,kind);
 loadHistory(id,kind);
}
function loadHistory(id,kind){
 getJson('/history?id='+encodeURIComponent(id),function(x){
  rememberHistory(x,id);
  if(x&&x.kind)historyKind=x.kind;
  if(historyId===id)fillHistorySheet(id,kind);
  render();
 },function(){
  if(historyId!==id)return;
  if(historyById[id]){fillHistorySheet(id,kind);return;}
  var rows=document.getElementById('history-rows');
  if(rows)rows.innerHTML='<p class="history-empty">Could not load history.</p>';
 });
}
function gridSvg(plan){
 var w=plan.width||800, h=plan.height||600, html='', col, row;
 var maxCol=Math.ceil(w/CELL), maxRow=Math.ceil(h/CELL);
 for(col=0;col<=maxCol;col++)html+='<line class="grid-line'+(col%5===0?' major':'')+'" x1="'+(col*CELL)+'" y1="0" x2="'+(col*CELL)+'" y2="'+h+'"/>';
 for(row=0;row<=maxRow;row++)html+='<line class="grid-line'+(row%5===0?' major':'')+'" x1="0" y1="'+(row*CELL)+'" x2="'+w+'" y2="'+(row*CELL)+'"/>';
 for(col=0;col<maxCol;col++)html+='<text class="grid-label" x="'+(col*CELL+CELL/2)+'" y="14">'+esc(colLabel(col))+'</text>';
 for(row=0;row<maxRow;row++)html+='<text class="grid-label row" x="6" y="'+(row*CELL+CELL/2+3)+'">'+(row+1)+'</text>';
 return html;
}
function along(wall){return wall==='n'||wall==='s'?{x:1,y:0}:{x:0,y:1};}
function inward(wall){return wall==='n'?{x:0,y:1}:wall==='s'?{x:0,y:-1}:wall==='e'?{x:-1,y:0}:{x:1,y:0};}
function doorSvg(d){
 var len=Number(d.length)||20,a=along(d.wall),inn=inward(d.wall);
 var n=d.swing==='out'?{x:-inn.x,y:-inn.y}:inn;
 var start={x:d.x,y:d.y},end={x:d.x+a.x*len,y:d.y+a.y*len};
 var hinge=d.hinge==='end'?end:start,closed=d.hinge==='end'?start:end;
 var tip={x:hinge.x+n.x*len,y:hinge.y+n.y*len};
 var sweep=((closed.x-hinge.x)*(tip.y-hinge.y)-(closed.y-hinge.y)*(tip.x-hinge.x))>0?1:0;
 return '<path class="door-swing" d="M '+closed.x+' '+closed.y+' A '+len+' '+len+' 0 0 '+sweep+' '+tip.x+' '+tip.y+'"/><line class="door" x1="'+hinge.x+'" y1="'+hinge.y+'" x2="'+tip.x+'" y2="'+tip.y+'"/>';
}
function windowSvg(w){
 var gap=3,a=along(w.wall),n=inward(w.wall),len=Number(w.length)||20;
 var s={x:w.x,y:w.y},e={x:w.x+a.x*len,y:w.y+a.y*len};
 function line(sign){return '<line class="window" x1="'+(s.x+n.x*gap*sign)+'" y1="'+(s.y+n.y*gap*sign)+'" x2="'+(e.x+n.x*gap*sign)+'" y2="'+(e.y+n.y*gap*sign)+'"/>';}
 return line(1)+line(-1);
}
function glyph(kind,on){
 var f=on?' class="filled"':'';
 if(kind==='light')return '<circle cx="0" cy="-1" r="6"'+f+'/><path d="M-2.5 6h5v2.5h-5z"'+f+'/>';
 if(kind==='plug')return '<rect x="-4.5" y="-1" width="9" height="8" rx="1.4"'+f+'/><path d="M-2 -1v-4.5M2 -1v-4.5"/><path d="M-1.4 7v2.2h2.8V7"'+f+'/>';
 if(kind==='leak')return '<path d="M0 -8 C4 -2 6 2 6 5 A6 6 0 1 1 -6 5 C-6 2 -4 -2 0 -8z"'+f+'/>';
 if(kind==='contact'||kind==='lock')return (on?'<path d="M-3.5 -2.5v-2a3.5 3.5 0 0 1 7 0"/>':'<path d="M-3.5 -2.5v-2a3.5 3.5 0 0 1 7 0v2"/>')+'<rect x="-5.5" y="-2.5" width="11" height="10" rx="1.5"'+(on?'':' class="filled"')+'/>'+(kind==='lock'?'<circle cx="0" cy="2" r="1.1"/><path d="M0 3v3"/>':'');
 if(kind==='motion')return '<circle cx="0" cy="1" r="3.2"'+f+'/><path d="M-6 -2a8 8 0 0 1 12 0"/><path d="M-8.5 -5a12 12 0 0 1 17 0"/>';
 return '<rect x="-6.2" y="-8" width="3.4" height="10" rx="1.7"/><circle cx="-4.5" cy="5.4" r="3.4" class="filled"/><path d="M4.2 -7C6.4 -3 7.4 -0.6 7.4 2.2A3.4 3.4 0 1 1 0.6 2.2C0.6 -0.6 1.8 -3 4.2 -7z"/>';
}
function setSvg(svg, html){
 var i, root, parsed;
 try{svg.innerHTML=html;if(svg.childNodes&&svg.childNodes.length)return;}catch(e){}
 while(svg.firstChild)svg.removeChild(svg.firstChild);
 try{
  parsed=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+html+'</svg>','image/svg+xml');
  root=parsed.documentElement;
  for(i=0;i<root.childNodes.length;i++){
   svg.appendChild(document.importNode(root.childNodes[i],true));
  }
 }catch(e2){}
}
function sensorLabel(s,d){
 if(s.label)return s.label;
 if(d&&d.name)return d.name;
 return s.deviceId||'';
}
function deviceRow(d){
 var extra='';
 var second=detail(d);
 var battery=batteryPercent(d);
 var batteryClass='battery'+(battery<20?' low':'');
 var batteryFill=Math.round(battery*1.16)/10;
 var batteryInner='<svg viewBox="0 0 18 10" aria-hidden="true"><rect x=".6" y=".6" width="14" height="8.8" rx="1"/><rect class="battery-fill" x="1.8" y="1.8" width="'+batteryFill+'" height="6.4" rx=".4"/><path d="M15.5 3h1.9v4h-1.9"/></svg>'+Math.round(battery)+'%';
 var batteryHtml=finite(battery)?'<small class="'+batteryClass+'">'+batteryInner+'</small>':'';
 var secondHtml=second?'<small>'+esc(second)+'</small>':'';
 if(d.kind==='motion'&&second&&finite(battery)){
  secondHtml='<small class="reading-detail">'+esc(second)+'<span class="'+batteryClass+'">'+batteryInner+'</span></small>';
  batteryHtml='';
 }
 if(d.kind!=='light'&&d.kind!=='plug'){
  extra='<span class="reading"><strong>'+esc(headline(d))+'</strong>'+secondHtml+batteryHtml+'</span>';
 }else if(second||batteryHtml){
  extra='<span class="reading">'+secondHtml+batteryHtml+'</span>';
 }
 var ctl=d.kind==='light'?lightControls(d):d.kind==='plug'?plugControls(d):'';
 var place=devicePlace(d);
 /* invertContact() stays available; Invert button hidden on this page */
 var inner='<span>'+esc(kindLabel(d))+(place?'<small>'+esc(place)+'</small>':'')+'</span><span class="device-end">'+ctl+extra+'</span>';
 var cls='device'+(d.kind==='light'?' light':'')+(isDead(d)||isStale(d)?' stale':'');
 if(hasHistory(d)){
  return '<button type="button" class="'+cls+'" onclick="openHistory(\''+esc(d.id)+'\',\''+d.kind+'\')">'+inner+hourDotsHtml(d.id)+'</button>';
 }
 return '<div class="'+cls+'">'+inner+'</div>';
}
function zipKinds(a,b){
 var out=[], n=Math.min(a.length,b.length), i;
 for(i=0;i<n;i++){out.push(a[i],b[i]);}
 return out.concat(a.slice(n),b.slice(n));
}
function rowsOf(list){
 var html='', i;
 for(i=0;i<list.length;i++)html+=deviceRow(list[i]);
 return html;
}
function phoneDeviceHtml(devices){
 var contact=[], motion=[], plugs=[], temp=[], lights=[], rest=[], i, d, groups, html='';
 for(i=0;i<devices.length;i++){
  d=devices[i];
  if(d.kind==='contact')contact.push(d);
  else if(d.kind==='motion')motion.push(d);
  else if(d.kind==='plug')plugs.push(d);
  else if(d.kind==='light')lights.push(d);
  else if(isClimate(d.kind)&&kindLabel(d)==='Temp/Humidity')temp.push(d);
  else rest.push(d);
 }
 groups=[{pair:true,items:zipKinds(contact,motion)},{pair:true,items:plugs},{pair:true,items:temp},{pair:true,items:lights},{pair:true,items:rest}];
 for(i=0;i<groups.length;i++){
  if(!groups[i].items.length)continue;
  html+='<div class="device-group'+(groups[i].pair?' pair':'')+'">'+rowsOf(groups[i].items)+'</div>';
 }
 return html;
}
function render(){
 var ae=document.activeElement;
 if(ae&&ae.type==='range')return;
 var plan=home();
 var devices=sortDevices(all()), byId={}, i, d, html='', r, s, lx, ly, pts, active, mid, left='', right='';
 for(i=0;i<devices.length;i++)byId[devices[i].id]=devices[i];
 mid=Math.ceil(devices.length/2);
 for(i=0;i<devices.length;i++){
  if(i<mid)left+=deviceRow(devices[i]);
  else right+=deviceRow(devices[i]);
 }
 document.getElementById('devices').innerHTML='<div class="device-cols"><div class="device-col">'+left+'</div><div class="device-col">'+right+'</div></div><div class="device-phone">'+phoneDeviceHtml(devices)+'</div>';
 var svg=document.getElementById('plan');
 svg.setAttribute('viewBox','0 0 '+(plan.width||800)+' '+(plan.height||600));
 html='';
 var rooms=plan.rooms||[];
 for(i=0;i<rooms.length;i++){
  r=rooms[i];
  lx=r.label&&r.label.x!=null?r.label.x:r.x+r.w/2;
  ly=r.label&&r.label.y!=null?r.label.y:r.y+r.h/2;
  pts='';
  if(r.points){for(var p=0;p<r.points.length;p++)pts+=(p?',':'')+r.points[p].x+','+r.points[p].y;}
  if(pts)html+='<polygon class="room" points="'+pts+'"/><text class="room-name" x="'+lx+'" y="'+ly+'">'+esc(r.name)+'</text>';
  else html+='<rect class="room" x="'+r.x+'" y="'+r.y+'" width="'+r.w+'" height="'+r.h+'"/><text class="room-name" x="'+(r.x+r.w/2)+'" y="'+(r.y+r.h/2)+'">'+esc(r.name)+'</text>';
 }
 var doors=plan.doors||[];
 for(i=0;i<doors.length;i++)html+=doorSvg(doors[i]);
 var windows=plan.windows||[];
 for(i=0;i<windows.length;i++)html+=windowSvg(windows[i]);
 if(showGrid)html+=gridSvg(plan);
 var sensors=plan.sensors||[];
 for(i=0;i<sensors.length;i++){
  s=sensors[i];
  d=s.deviceId?byId[s.deviceId]:null;
  if(isClimate(s.kind))html+='<g transform="translate('+s.x+' '+s.y+')">'+climateSvg(d)+'</g>';
  else{
   active=!!(d&&(d.on||d.state==='OPEN'||d.state==='DETECTED'||d.state==='LEAK'||d.state==='UNLOCKED'));
   var tap=(s.kind==='contact'||s.kind==='motion'||s.kind==='leak')&&s.deviceId;
   html+='<g transform="translate('+s.x+' '+s.y+')"'+
    (tap?' class="sensor-tap" onclick="openHistory(\''+esc(s.deviceId)+'\',\''+s.kind+'\')"':'')+
    '><g class="icon'+(isDead(d)||isStale(d)?' dead':'')+'">'+glyph(s.kind,active)+'</g>'+(showNames?'<text x="16" y="4" font-size="12">'+esc(sensorLabel(s,d))+'</text>':'')+'</g>';
  }
 }
 setSvg(svg,html);
 drawModes();
}
function mark(ok,label){
 var el=document.getElementById('live');
 if(!el)return;
 if(el.textContent!==undefined)el.textContent=label;
 else el.innerHTML=label;
 el.className=ok?'ok':'off';
}
var statePoll=null, stateEvents=null, stateWatchdog=null, statePulling=false, lastSseAt=0;
function applyState(x){
 var next=(x&&x.state)?x.state:x;
 if(next&&x&&x.readings)next.readings=x.readings;
 state=next||{};
 mark(true,'LOCAL');
 render();
 pullHistory(false);
 if(historyId)fillHistorySheet(historyId,historyKind);
}
function pullState(){
 if(statePulling)return;
 statePulling=true;
 getJson('/state.json',function(x){
  statePulling=false;
  applyState(x);
 },function(){
  statePulling=false;
  mark(false,state.lights||state.plugs?'RECONNECTING':'OFFLINE');
 });
}
function startStatePoll(){
 if(statePoll===null){pullState();statePoll=setInterval(pullState,2000);}
}
function stopStatePoll(){
 if(statePoll!==null){clearInterval(statePoll);statePoll=null;}
}
function touchStateEvents(){lastSseAt=Date.now();}
function connectStateEvents(){
 if(typeof EventSource==='undefined'){startStatePoll();return;}
 if(stateEvents)stateEvents.close();
 touchStateEvents();
 stateEvents=new EventSource('/events');
 stateEvents.addEventListener('state',function(event){
  touchStateEvents();
  try{applyState(JSON.parse(event.data));}
  catch(e){startStatePoll();}
 });
 stateEvents.addEventListener('ping',touchStateEvents);
 stateEvents.onopen=function(){touchStateEvents();mark(true,'LOCAL');stopStatePoll();};
 stateEvents.onerror=function(){
  mark(false,state.lights||state.plugs?'RECONNECTING':'OFFLINE');
  startStatePoll();
 };
}
function watchStateEvents(){
 if(stateEvents&&Date.now()-lastSseAt>10000){
  stateEvents.close();
  stateEvents=null;
  startStatePoll();
  connectStateEvents();
 }
}
function resumeState(){
 if(document.visibilityState!==undefined&&document.visibilityState!=='visible')return;
 pullState();
 if(!stateEvents||Date.now()-lastSseAt>10000)connectStateEvents();
}
function applyCloudPlan(p){
 if(!p||!p.id||!p.rooms)return;
 var i, found=false;
 for(i=0;i<HOMES.length;i++){
  if(HOMES[i].id===p.id){
   HOMES[i].width=p.width||HOMES[i].width;
   HOMES[i].height=p.height||HOMES[i].height;
   HOMES[i].rooms=p.rooms;
   HOMES[i].sensors=p.sensors||[];
   if(p.name)HOMES[i].name=p.name;
   found=true;
   break;
  }
 }
 if(!found)HOMES.push(p);
 drawHomes();
 render();
}
function pullPlan(){
 getJson('/plan.json',function(x){applyCloudPlan((x&&x.plan)?x.plan:x);});
}
function boot(){
 drawHomes();
 drawToggles();
 render();
 ensureToken();
 pullState();
 pullPlan();
 connectStateEvents();
 stateWatchdog=setInterval(watchStateEvents,1000);
 document.addEventListener('visibilitychange',resumeState);
 window.addEventListener('focus',resumeState);
 window.addEventListener('online',resumeState);
 window.addEventListener('pageshow',resumeState);
 window.addEventListener('keydown',function(event){if(event.key==='Escape')closeHistory();});
 setInterval(pullPlan,4000);
}
boot();
</script></body></html>
)HTML";

static char *spiram_copy(const char *value)
{
    if (value == nullptr) {
        return nullptr;
    }
    const size_t length = strlen(value);
    auto *copy = static_cast<char *>(heap_caps_malloc(length + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (copy != nullptr) {
        memcpy(copy, value, length + 1);
    }
    return copy;
}

static void load_or_create_token(void)
{
    nvs_handle_t nvs;
    if (nvs_open("homehub_status", NVS_READWRITE, &nvs) != ESP_OK) {
        return;
    }
    size_t length = sizeof(s_token);
    if (nvs_get_str(nvs, "token", s_token, &length) != ESP_OK || strlen(s_token) != 32) {
        snprintf(s_token, sizeof(s_token), "%08lx%08lx%08lx%08lx",
                 static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
                 static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
        (void)nvs_set_str(nvs, "token", s_token);
        (void)nvs_commit(nvs);
    }
    nvs_close(nvs);
}

static void load_plan(void)
{
    nvs_handle_t nvs;
    if (nvs_open("homehub_status", NVS_READONLY, &nvs) != ESP_OK) {
        s_plan = spiram_copy(kDefaultPlan);
        return;
    }
    size_t length = 0;
    if (nvs_get_str(nvs, "plan", nullptr, &length) != ESP_OK || length > kMaxPlanBytes + 1) {
        nvs_close(nvs);
        s_plan = spiram_copy(kDefaultPlan);
        return;
    }
    s_plan = static_cast<char *>(heap_caps_malloc(length, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (s_plan == nullptr || nvs_get_str(nvs, "plan", s_plan, &length) != ESP_OK) {
        free(s_plan);
        s_plan = spiram_copy(kDefaultPlan);
    }
    nvs_close(nvs);
}

static esp_err_t index_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, kIndexHtml, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t state_handler(httpd_req_t *req)
{
    char *json = homehub_aws_build_state_json();
    if (json == nullptr) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "state unavailable");
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    const esp_err_t result = httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
    free(json);
    return result;
}

static esp_err_t plan_handler(httpd_req_t *req)
{
    portENTER_CRITICAL(&s_plan_lock);
    const char *plan = s_plan != nullptr ? s_plan : kDefaultPlan;
    char *copy = spiram_copy(plan);
    portEXIT_CRITICAL(&s_plan_lock);
    if (copy == nullptr) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "plan unavailable");
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    const esp_err_t result = httpd_resp_send(req, copy, HTTPD_RESP_USE_STRLEN);
    free(copy);
    return result;
}

static esp_err_t auth_handler(httpd_req_t *req)
{
    char response[48];
    snprintf(response, sizeof(response), "{\"token\":\"%s\"}", s_token);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, response);
}

static bool history_id_ok(const char *device_id)
{
    if (device_id == nullptr || device_id[0] == '\0') {
        return false;
    }
    for (const char *cursor = device_id; *cursor != '\0'; ++cursor) {
        const char ch = *cursor;
        const bool ok = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                        (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == ':';
        if (!ok) {
            return false;
        }
    }
    return true;
}

static esp_err_t history_handler(httpd_req_t *req)
{
    char query[80] = {};
    char device_id[24] = {};
    const bool have_query = httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK && query[0] != '\0';
    if (have_query) {
        if (httpd_query_key_value(query, "id", device_id, sizeof(device_id)) != ESP_OK ||
            !history_id_ok(device_id)) {
            return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "id required");
        }
    }
    char *json = homehub_history_json(have_query ? device_id : nullptr);
    if (json == nullptr) {
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "history unavailable");
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    const esp_err_t result = httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
    free(json);
    return result;
}

static bool request_authorized(httpd_req_t *req)
{
    char token[sizeof(s_token)] = {};
    return httpd_req_get_hdr_value_str(req, "X-HomeHub-Token", token, sizeof(token)) == ESP_OK &&
           s_token[0] != '\0' && strcmp(token, s_token) == 0;
}

static esp_err_t light_handler(httpd_req_t *req)
{
    if (!request_authorized(req)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "token required");
    }
    if (req->content_len <= 0 || req->content_len > 160) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    char body[161] = {};
    const int received = httpd_req_recv(req, body, req->content_len);
    if (received <= 0) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    cJSON *root = cJSON_ParseWithLength(body, static_cast<size_t>(received));
    const cJSON *on = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "on") : nullptr;
    const cJSON *brightness = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "brightness") : nullptr;
    const cJSON *id = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "id") : nullptr;
    const bool have_on = cJSON_IsBool(on);
    const bool have_bri = cJSON_IsNumber(brightness);
    const char *device_id = cJSON_IsString(id) ? id->valuestring : nullptr;
    if (!have_on && !have_bri) {
        cJSON_Delete(root);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "on or brightness required");
    }
    if (s_command_handler != nullptr) {
        char command[40];
        if (have_bri) {
            int percent = brightness->valueint;
            if (percent < 0) {
                percent = 0;
            }
            if (percent > 100) {
                percent = 100;
            }
            if (device_id != nullptr && device_id[0] != '\0') {
                snprintf(command, sizeof(command), "light-bri-%s-%d", device_id, percent);
            } else {
                snprintf(command, sizeof(command), "light-bri-%d", percent);
            }
            s_command_handler(command);
        } else if (cJSON_IsTrue(on)) {
            if (device_id != nullptr && device_id[0] != '\0') {
                snprintf(command, sizeof(command), "light-on-%s", device_id);
                s_command_handler(command);
            } else {
                s_command_handler("light-on");
            }
        } else if (device_id != nullptr && device_id[0] != '\0') {
            snprintf(command, sizeof(command), "light-off-%s", device_id);
            s_command_handler(command);
        } else {
            s_command_handler("light-off");
        }
    }
    cJSON_Delete(root);
    httpd_resp_set_status(req, "202 Accepted");
    return httpd_resp_sendstr(req, "{\"accepted\":true}");
}

static esp_err_t plug_handler(httpd_req_t *req)
{
    if (!request_authorized(req)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "token required");
    }
    if (req->content_len <= 0 || req->content_len > 96) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    char body[97] = {};
    const int received = httpd_req_recv(req, body, req->content_len);
    if (received <= 0) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    cJSON *root = cJSON_ParseWithLength(body, static_cast<size_t>(received));
    const cJSON *on = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "on") : nullptr;
    const cJSON *id = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "id") : nullptr;
    if (!cJSON_IsBool(on)) {
        cJSON_Delete(root);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "on required");
    }
    if (s_command_handler != nullptr) {
        const bool second = cJSON_IsString(id) && id->valuestring != nullptr &&
                            strcmp(id->valuestring, "matter-10") == 0;
        if (second) {
            s_command_handler(cJSON_IsTrue(on) ? "plug-on-11" : "plug-off-11");
        } else {
            s_command_handler(cJSON_IsTrue(on) ? "plug-on" : "plug-off");
        }
    }
    cJSON_Delete(root);
    httpd_resp_set_status(req, "202 Accepted");
    return httpd_resp_sendstr(req, "{\"accepted\":true}");
}

static esp_err_t contact_handler(httpd_req_t *req)
{
    if (!request_authorized(req)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "token required");
    }
    if (req->content_len <= 0 || req->content_len > 96) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    char body[97] = {};
    const int received = httpd_req_recv(req, body, req->content_len);
    if (received <= 0) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    cJSON *root = cJSON_ParseWithLength(body, static_cast<size_t>(received));
    const cJSON *invert = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "invert") : nullptr;
    if (!cJSON_IsBool(invert)) {
        cJSON_Delete(root);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invert required");
    }
    homehub_aws_set_contact_invert(cJSON_IsTrue(invert) ? 1 : 0);
    cJSON_Delete(root);
    (void)homehub_aws_publish_state(nullptr);
    homehub_aws_notify_state_changed();
    httpd_resp_set_status(req, "202 Accepted");
    return httpd_resp_sendstr(req, "{\"accepted\":true}");
}

static esp_err_t scene_handler(httpd_req_t *req)
{
    if (!request_authorized(req)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "token required");
    }
    if (req->content_len <= 0 || req->content_len > 80) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    char body[81] = {};
    const int received = httpd_req_recv(req, body, req->content_len);
    if (received <= 0) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "invalid body");
    }
    cJSON *root = cJSON_ParseWithLength(body, static_cast<size_t>(received));
    const cJSON *scene = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "scene") : nullptr;
    const cJSON *item = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "command") : nullptr;
    const char *name = nullptr;
    if (cJSON_IsString(scene) && (strcmp(scene->valuestring, "home") == 0 || strcmp(scene->valuestring, "away") == 0)) {
        name = scene->valuestring;
    } else if (cJSON_IsString(item) &&
               (strcmp(item->valuestring, "home") == 0 || strcmp(item->valuestring, "away") == 0 ||
                strcmp(item->valuestring, "all-lights-off") == 0 ||
                strcmp(item->valuestring, "all-plugs-off") == 0)) {
        name = item->valuestring;
    }
    if (name == nullptr) {
        cJSON_Delete(root);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "scene required");
    }
    char payload[40];
    snprintf(payload, sizeof(payload), "{\"command\":\"%s\"}", name);
    cJSON_Delete(root);
    homehub_aws_on_command(payload);
    homehub_aws_notify_state_changed();
    httpd_resp_set_status(req, "202 Accepted");
    return httpd_resp_sendstr(req, "{\"accepted\":true}");
}

static esp_err_t events_handler(httpd_req_t *req)
{
    size_t slot = kMaxSseClients;
    portENTER_CRITICAL(&s_sse_lock);
    for (size_t i = 0; i < kMaxSseClients; ++i) {
        if (s_sse_reqs[i] == nullptr) {
            slot = i;
            break;
        }
    }
    portEXIT_CRITICAL(&s_sse_lock);
    if (slot == kMaxSseClients) {
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, nullptr, 0);
    }

    httpd_req_t *async_req = nullptr;
    if (httpd_req_async_handler_begin(req, &async_req) != ESP_OK) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_sendstr(req, "stream unavailable");
    }
    portENTER_CRITICAL(&s_sse_lock);
    s_sse_reqs[slot] = async_req;
    portEXIT_CRITICAL(&s_sse_lock);
    httpd_resp_set_type(async_req, "text/event-stream");
    httpd_resp_set_hdr(async_req, "Cache-Control", "no-cache");
    httpd_resp_set_hdr(async_req, "Connection", "keep-alive");
    if (httpd_resp_send_chunk(async_req, "retry: 2000\n\n", HTTPD_RESP_USE_STRLEN) != ESP_OK) {
        portENTER_CRITICAL(&s_sse_lock);
        if (s_sse_reqs[slot] == async_req) {
            s_sse_reqs[slot] = nullptr;
        }
        portEXIT_CRITICAL(&s_sse_lock);
        httpd_req_async_handler_complete(async_req);
        return ESP_FAIL;
    }
    homehub_status_notify();
    return ESP_OK;
}

struct SseWork {
    char *json;
};

static void send_sse(void *arg)
{
    auto *work = static_cast<SseWork *>(arg);
    const bool heartbeat = work->json == nullptr;
    for (size_t i = 0; i < kMaxSseClients; ++i) {
        portENTER_CRITICAL(&s_sse_lock);
        httpd_req_t *req = s_sse_reqs[i];
        portEXIT_CRITICAL(&s_sse_lock);
        if (req == nullptr) {
            continue;
        }
        esp_err_t result = httpd_resp_send_chunk(
            req, heartbeat ? "event: ping\ndata: {}\n\n" : "event: state\ndata: ", HTTPD_RESP_USE_STRLEN);
        if (result == ESP_OK && !heartbeat) {
            result = httpd_resp_send_chunk(req, work->json, HTTPD_RESP_USE_STRLEN);
        }
        if (result == ESP_OK && !heartbeat) {
            result = httpd_resp_send_chunk(req, "\n\n", HTTPD_RESP_USE_STRLEN);
        }
        if (result == ESP_OK) {
            continue;
        }
        portENTER_CRITICAL(&s_sse_lock);
        if (s_sse_reqs[i] == req) {
            s_sse_reqs[i] = nullptr;
        }
        portEXIT_CRITICAL(&s_sse_lock);
        httpd_req_async_handler_complete(req);
    }
    free(work->json);
    free(work);
}

static void queue_sse_heartbeat()
{
    if (s_server == nullptr) {
        return;
    }
    bool connected = false;
    portENTER_CRITICAL(&s_sse_lock);
    for (size_t i = 0; i < kMaxSseClients; ++i) {
        connected = connected || s_sse_reqs[i] != nullptr;
    }
    portEXIT_CRITICAL(&s_sse_lock);
    if (!connected) {
        return;
    }
    auto *work = static_cast<SseWork *>(heap_caps_malloc(sizeof(SseWork), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (work == nullptr) {
        return;
    }
    work->json = nullptr;
    if (httpd_queue_work(s_server, send_sse, work) != ESP_OK) {
        free(work);
    }
}

void homehub_status_notify(void)
{
    if (s_server == nullptr) {
        return;
    }
    bool connected = false;
    portENTER_CRITICAL(&s_sse_lock);
    for (size_t i = 0; i < kMaxSseClients; ++i) {
        connected = connected || s_sse_reqs[i] != nullptr;
    }
    portEXIT_CRITICAL(&s_sse_lock);
    if (!connected) {
        return;
    }
    char *json = homehub_aws_build_state_json();
    char *copy = spiram_copy(json);
    free(json);
    auto *work = static_cast<SseWork *>(heap_caps_malloc(sizeof(SseWork), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (copy == nullptr || work == nullptr) {
        free(copy);
        free(work);
        return;
    }
    work->json = copy;
    if (httpd_queue_work(s_server, send_sse, work) != ESP_OK) {
        free(copy);
        free(work);
    }
}

void homehub_status_apply_config(const char *json)
{
    cJSON *root = cJSON_Parse(json);
    cJSON *plan = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "plan") : nullptr;
    cJSON *version = plan != nullptr ? cJSON_GetObjectItemCaseSensitive(plan, "version") : nullptr;
    cJSON *rooms = plan != nullptr ? cJSON_GetObjectItemCaseSensitive(plan, "rooms") : nullptr;
    cJSON *sensors = plan != nullptr ? cJSON_GetObjectItemCaseSensitive(plan, "sensors") : nullptr;
    if (!cJSON_IsNumber(version) || version->valueint != 1 || !cJSON_IsArray(rooms) || !cJSON_IsArray(sensors)) {
        ESP_LOGW(TAG, "Rejected invalid plan config");
        cJSON_Delete(root);
        return;
    }
    char *printed = cJSON_PrintUnformatted(plan);
    cJSON_Delete(root);
    if (printed == nullptr || strlen(printed) > kMaxPlanBytes) {
        ESP_LOGW(TAG, "Rejected oversized plan config");
        free(printed);
        return;
    }
    char *copy = spiram_copy(printed);
    if (copy != nullptr) {
        portENTER_CRITICAL(&s_plan_lock);
        char *old = s_plan;
        s_plan = copy;
        portEXIT_CRITICAL(&s_plan_lock);
        free(old);
        ESP_LOGI(TAG, "Updated cached floor plan");
    }
    nvs_handle_t nvs = 0;
    if (nvs_open("homehub_status", NVS_READWRITE, &nvs) != ESP_OK ||
        nvs_set_str(nvs, "plan", printed) != ESP_OK || nvs_commit(nvs) != ESP_OK) {
        ESP_LOGW(TAG, "Failed to persist plan");
        if (nvs != 0) {
            nvs_close(nvs);
        }
    } else {
        nvs_close(nvs);
    }
    free(printed);
}

static bool sta_has_ip(void)
{
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t info = {};
    return netif != nullptr && esp_netif_get_ip_info(netif, &info) == ESP_OK && info.ip.addr != 0;
}

static void status_task(void *)
{
    while (!sta_has_ip()) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    load_or_create_token();
    load_plan();
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 6144;
    config.max_open_sockets = 5;
    config.max_uri_handlers = 10;
    config.lru_purge_enable = true;
    config.recv_wait_timeout = 5;
    config.send_wait_timeout = 5;
    if (httpd_start(&s_server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start local status server");
        vTaskDelete(nullptr);
        return;
    }
    const httpd_uri_t handlers[] = {
        {.uri = "/", .method = HTTP_GET, .handler = index_handler},
        {.uri = "/state.json", .method = HTTP_GET, .handler = state_handler},
        {.uri = "/plan.json", .method = HTTP_GET, .handler = plan_handler},
        {.uri = "/auth", .method = HTTP_GET, .handler = auth_handler},
        {.uri = "/events", .method = HTTP_GET, .handler = events_handler},
        {.uri = "/history", .method = HTTP_GET, .handler = history_handler},
        {.uri = "/light", .method = HTTP_POST, .handler = light_handler},
        {.uri = "/plug", .method = HTTP_POST, .handler = plug_handler},
        {.uri = "/contact", .method = HTTP_POST, .handler = contact_handler},
        {.uri = "/scene", .method = HTTP_POST, .handler = scene_handler},
    };
    for (const httpd_uri_t &handler : handlers) {
        ESP_ERROR_CHECK(httpd_register_uri_handler(s_server, &handler));
    }
    ESP_LOGI(TAG, "Local status page ready on port 80");
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        queue_sse_heartbeat();
    }
}

int homehub_status_start(homehub_status_command_handler_t command_handler)
{
    s_command_handler = command_handler;
    homehub_aws_set_state_handler(homehub_status_notify);
    homehub_aws_set_config_handler(homehub_status_apply_config);
    return xTaskCreate(status_task, "homehub_status", 3072, nullptr, 4, nullptr) == pdPASS ? 0 : -1;
}
