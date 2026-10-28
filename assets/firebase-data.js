/* Shared Firebase compat helpers: bounded metadata pages, never payload-list reads. */
(function (global) {
  'use strict';
  var known = new Map(), lists = new Map(), details = new Map(), detailBytes=0;
  function forget(path){var old=details.get(path);if(old){detailBytes-=old.bytes;details.delete(path);}}
  function remember(path,value){
    forget(path);if(!value)return;
    var serialized=JSON.stringify(value),bytes=new TextEncoder().encode(serialized).length;
    if(bytes>24*1024*1024)return;
    details.set(path,{value:JSON.parse(serialized),bytes:bytes,time:Date.now()});detailBytes+=bytes;
    while(detailBytes>24*1024*1024 || details.size>10)forget(details.keys().next().value);
  }
  async function detail(db,path){
    var hit=details.get(path);
    if(hit && Date.now()-hit.time<5*60*1000){details.delete(path);details.set(path,hit);return JSON.parse(JSON.stringify(hit.value));}
    var value=(await db.ref(path).get()).val();remember(path,value);return value;
  }
  function metadata(value) {
    var result = {};
    ['id','title','name','model','modelName','ownerUid','publisherUid','publisherName','mood','remixOfName'].forEach(function(k){
      if (typeof value[k] === 'string') result[k] = value[k].slice(0,120);
    });
    ['updated','created'].forEach(function(k){ if (Number.isFinite(value[k])) result[k] = value[k]; });
    if (typeof value.remixable === 'boolean') result.remixable = value.remixable;
    if (Array.isArray(value.keywords)) result.keywords = value.keywords.slice(0,8).map(function(s){return String(s).slice(0,40);});
    if (value.thumbnail && value.thumbnail.length <= 24576) result.thumbnail = value.thumbnail;
    if (value.theme) {
      result.theme = {};
      ['background','text_primary','text_secondary','accent_1','accent_2','heading_font','body_font'].forEach(function(k){if(typeof value.theme[k]==='string')result.theme[k]=value.theme[k].slice(0,80);});
      var first = (value.theme.slides || [])[0];
      if (first) { var slide = {}; ['layout','eyebrow','heading','body'].forEach(function(k){if(typeof first[k]==='string')slide[k]=first[k].slice(0,300);}); result.theme.slides=[slide]; }
    }
    return result;
  }
  async function save(db, detailPath, indexPath, value, merge) {
    if(Array.isArray(value.messages)&&value.messages.length>200 || Array.isArray(value.turns)&&value.turns.length>200)throw Error('This thread reached the 200-message/turn save limit. Start a new thread; existing history has not been truncated.');
    if(new TextEncoder().encode(JSON.stringify(value)).length>8*1024*1024)throw Error('This item exceeds the 8 MiB save budget. Start a new conversation or reduce the attachment size.');
    var writes = {}, meta = metadata(Object.assign({}, known.get(indexPath), value));
    if (merge) Object.keys(value).forEach(function(k){writes[detailPath+'/'+k]=value[k];});
    else writes[detailPath]=value;
    writes[indexPath]=meta;
    known.set(indexPath,meta);
    await db.ref().update(writes);
    var old=details.get(detailPath);
    if(!merge || old)remember(detailPath,merge?Object.assign({},old.value,value):value);
  }
  function remove(db, detailPath, indexPath) { var writes={};writes[detailPath]=null;writes[indexPath]=null;known.delete(indexPath);forget(detailPath);return db.ref().update(writes); }
  async function page(db, path, field, render, host) {
    if (lists.has(path)) lists.get(path).dispose();
    var rows = new Map(), cursor = null, disposed=false;
    var button=document.createElement('button');button.type='button';button.textContent='Load older';button.style.cssText='margin:12px;padding:10px;cursor:pointer';
    var parent=typeof host==='string'?document.querySelector(host):host;
    if (!parent) throw Error('List container missing: '+host);
    // Place outside a container whose innerHTML is replaced by render().
    parent.parentNode.insertBefore(button,parent.nextSibling);
    var state={dispose:function(){disposed=true;button.remove();}};lists.set(path,state);
    async function next(){
      button.disabled=true;
      try {
        var query=field==='$key'?db.ref(path).orderByKey():db.ref(path).orderByChild(field);
        if(cursor) query=field==='$key'?query.endBefore(cursor.key):query.endBefore(cursor.value,cursor.key);
        var snap=await query.limitToLast(50).once('value'), first=null, count=0;
        snap.forEach(function(child){if(!/^[A-Za-z0-9_-]{1,128}$/.test(child.key))return;var value=child.val();if(!first)first={value:value[field] || 0,key:child.key};count++;rows.set(child.key,Object.assign({},value,{id:child.key}));known.set(path+'/'+child.key,value);});
        if(disposed)return;
        cursor=first;
        var values=Array.from(rows.values()).sort(function(a,b){return(b[field]||0)-(a[field]||0);});
        await render(values);
        button.hidden=count<50;
      } catch(e){button.textContent='Retry loading older';throw e;}
      finally {button.disabled=false;}
    }
    button.onclick=function(){next().catch(function(e){alert('Could not load page: '+e.message);});};
    await next();return state;
  }
  function artCanvas(cells,maxSize) {
    var keys=Object.keys(cells || {}), points=keys.map(function(k){var p=k.split('_');return [+p[0],+p[1],cells[k]];}).filter(function(p){return Number.isFinite(p[0])&&Number.isFinite(p[1]);});
    var canvas=document.createElement('canvas');
    if(!points.length){canvas.width=canvas.height=1;return canvas;}
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    points.forEach(function(p){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);});
    var scale=Math.min(1,maxSize/Math.max(maxX-minX+1,maxY-minY+1));
    canvas.width=Math.max(1,Math.ceil((maxX-minX+1)*scale));canvas.height=Math.max(1,Math.ceil((maxY-minY+1)*scale));
    var ctx=canvas.getContext('2d');points.forEach(function(p){ctx.fillStyle=p[2];ctx.fillRect(Math.floor((p[0]-minX)*scale),Math.floor((p[1]-minY)*scale),Math.max(1,scale),Math.max(1,scale));});return canvas;
  }
  function safeMarkup(markup){
    if(!global.DOMPurify)throw Error('Slide sanitizer did not load. Reload before viewing untrusted templates.');
    return global.DOMPurify.sanitize(markup,{FORBID_TAGS:['script','iframe','object','embed','foreignObject','image','audio','video'],FORBID_ATTR:['src','srcset','href','xlink:href']});
  }
  global.HTData={detail:detail,safeMarkup:safeMarkup,metadata:metadata,save:save,remove:remove,page:page,artCanvas:artCanvas};
})(window);
