"""Generate the reviewable RTDB rules for general-database-4cb1c only."""
import json
from pathlib import Path

def string(n): return {'.validate': f'newData.isString() && newData.val().length <= {n}'}
def number(): return {'.validate': 'newData.isNumber()'}
def boolean(): return {'.validate': 'newData.isBoolean()'}
def obj(fields, required=None):
    return {**({'.validate': 'newData.hasChildren(' + json.dumps(required) + ')'} if required else {}), **fields, '$other': {'.validate': False}}
array_sequence = 0
def array(schema, count=200):
    global array_sequence
    array_sequence += 1
    variable = f"$entry{array_sequence}"
    # Rules have no serialized-byte-size/count API. Restrict numeric keys instead.
    pattern = '/^(0|[1-9][0-9]?)$/' if count==100 else '/^(0|[1-9]|1[0-9]|2[0-9]|3[0-9])$/' if count==40 else f'/^[0-{count-1}]$/' if count<=10 else '/^(0|[1-9][0-9]?|1[0-9][0-9])$/'
    child = dict(schema)
    child['.validate'] = f'{variable}.matches({pattern}) && (' + str(schema.get('.validate', 'true')) + ')'
    return {variable: child}

# Bounded-depth nested provider output, with string ceilings. Unknown nested values
# cannot extend forever; more specific schemas are used on access-critical nodes.
def bounded(depth, limit=65536):
    base=f'newData.isString() && newData.val().length <= {limit} || newData.isNumber() || newData.isBoolean()'
    if depth == 0: return {'.validate': base}
    return {'.validate': base + ' || newData.hasChildren()', f'$key{depth}': bounded(depth-1,limit)}

auth='auth != null'
own='auth != null && auth.uid === $uid'
admin='auth != null && auth.token.admin === true'
query="query.orderByChild === 'updated' && query.limitToLast != null && query.limitToLast <= 50"
message=obj({
    'role': {'.validate': "newData.val() === 'user' || newData.val() === 'assistant'"},
    **{k:string(262144) for k in ['text','prompt','error']},
    **{k:string(120) for k in ['model','modelName','action']},
    'image':string(8388608),'usedOriginal':boolean(),
    'meta':obj({'actionLabel':string(120),'reasoning':string(65536),'fallback':boolean()}),
    'content':{'.validate':'newData.isString() && newData.val().length <= 262144 || newData.hasChildren()',
        **array(obj({'type':string(20),'text':string(262144),'mime':string(80),'data':string(8388608),'url':string(8388608)}),8)}
},['role'])
conversation=obj({'title':string(120),'owner':{'.validate':'newData.val() === auth.uid'},'created':number(),'updated':number(),'model':string(120),'modelName':string(120),'pending':boolean(),'deep':boolean(),'ratio':string(20),'quality':string(20),'messages':array(message)},['updated'])
turn=obj({'query':string(16384),'answer':string(262144),'deep':boolean(),'pending':boolean(),'errored':boolean(),'subQueries':array(string(1024),40),'sources':array(bounded(2,16384),40)})
session=obj({'id':string(128),'title':string(120),'updated':number(),'turns':array(turn)},['updated'])
metadata=obj({**{k:string(120) for k in ['id','title','name','model','modelName','ownerUid','publisherUid','publisherName','mood','remixOfName']},'updated':number(),'created':number(),'remixable':boolean(),'keywords':array(string(40),8),'thumbnail':{'.validate':"newData.isString() && newData.val().length <= 24576 && newData.val().beginsWith('data:image/png;base64,')"},'theme':obj({**{k:string(80) for k in ['background','text_primary','text_secondary','accent_1','accent_2','heading_font','body_font']},'slides':array(obj({k:string(300) for k in ['layout','eyebrow','heading','body']}),1)}),'views':number(),'likeCount':number()})
private_node={'.read':own,'.write':own,**conversation}
rules={'.read':False,'.write':False,
 'users':{'$uid':{'conversations':{'$id':private_node}}},
 'image_ai_conversations':{'$uid':{'$id':private_node}},
 'image_gen_conversations':{'$uid':{'$id':private_node}},
 'research_users':{'$uid':{'sessions':{'$id':{'.read':own,'.write':own,**session}}}},
 'conversation_index':{'$uid':{'$kind':{'.read':own+' && '+query,'.indexOn':['updated'],'$id':{'.write':own,**metadata}}}},
}
room="root.child('art_rooms').child($room)"
member=f"auth != null && ({room}.child('owner').val() === auth.uid || {room}.child('members').child(auth.uid).exists()) && !{room}.child('banned').child(auth.uid).exists()"
owner=f"auth != null && {room}.child('owner').val() === auth.uid"
room_obj=obj({'owner':string(128),'ownerName':string(120),'name':string(120),'mode':string(20),'infinite':boolean(),'gridSize':{'.validate':'newData.isNumber() && newData.val() >= 1 && newData.val() <= 64'},'joinCode':string(5),'created':number(),'locked':boolean(),'publishedMuseumId':string(128),'remixOfMuseumId':string(128),'remixOfName':string(120),
 'members':{'$uid':{'.write':f"{owner} || (auth != null && auth.uid === $uid && (!newData.exists() || (!{room}.child('banned').child(auth.uid).exists() && (data.exists() || ({room}.child('locked').val() !== true && newData.child('code').val() === {room}.child('joinCode').val())))))",**obj({'name':string(120),'joinedAt':number(),'code':string(5)})}},
 'banned':{'$uid':obj({'name':string(120),'bannedAt':number()})}},['owner','name','joinCode','created','locked'])
room_obj['owner']['.validate']='newData.isString() && newData.val().length <= 128 && (!data.exists() ? newData.val() === auth.uid : newData.val() === data.val())'
rules['art_rooms']={'$room':{'.read':member,'.write':f"auth != null && ((!data.exists() && newData.child('owner').val() === auth.uid) || data.child('owner').val() === auth.uid)",**room_obj}}
rules['art_joincodes']={'$code':{'.read':auth,'.write':"auth != null && ((!data.exists() && root.child('art_rooms').child(newData.val()).child('owner').val() === auth.uid) || root.child('art_rooms').child(data.val()).child('owner').val() === auth.uid)",'.validate':"$code.matches(/^[A-Z0-9]{5}$/) && newData.isString() && root.child('art_rooms').child(newData.val()).child('joinCode').val() === $code"}}
rules['art_user_rooms']={'$uid':{'.read':own,'$room':{'.write':f"auth != null && ((auth.uid === $uid && (!newData.exists() || ({room}.child('members').child($uid).exists() && !{room}.child('banned').child($uid).exists()))) || (!newData.exists() && {room}.child('owner').val() === auth.uid))",'.validate':'newData.val() === true'}}}
pixel=obj({'c':{'.validate':"newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)"},'uid':{'.validate':'newData.val() === auth.uid'},'ts':{'.validate':'newData.isNumber() && newData.val() <= now && newData.val() >= now - 60000'}},['c','uid','ts'])
rules['art_pixels']={'$room':{
 'cells':{'.read':member,'.write':owner,"$pixel":{'.write':member,**pixel,'.validate':"$pixel.matches(/^(0|[1-5]?[0-9]|6[0-3])_(0|[1-5]?[0-9]|6[0-3])$/) && newData.hasChildren(['c','uid','ts'])"}},
 'chunks':{'.read':owner,'.write':owner,'$chunk':{'.read':member,'.validate':"$chunk.matches(/^[mp][0-9]{1,4}_[mp][0-9]{1,4}$/)",'$pixel':{'.write':member,**pixel,'.validate':"$pixel.matches(/^(0|[1-9]|1[0-5])_(0|[1-9]|1[0-5])$/) && newData.hasChildren(['c','uid','ts'])"}}}
}}
rules['art_presence']={'$room':{'.read':member,'$uid':{'.write':member+' && auth.uid === $uid',**obj({'name':string(120),'x':number(),'y':number(),'drawing':boolean(),'ts':{'.validate':'newData.isNumber() && newData.val() <= now && newData.val() >= now - 60000'}},['ts'])}}}
rules['art_chat']={'$room':{'.read':member+' && query.limitToLast != null && query.limitToLast <= 50','$message':{'.write':member+' && !data.exists() && newData.exists()',**obj({'uid':{'.validate':'newData.val() === auth.uid'},'name':string(120),'text':string(1000),'ts':{'.validate':'newData.val() === now'}},['uid','text','ts'])}}}
public_query="auth != null && query.orderByChild === 'created' && query.limitToLast != null && query.limitToLast <= 50"
slide_owner="auth != null && data.child('ownerUid').val() === auth.uid"
museum_owner="auth != null && data.child('publisherUid').val() === auth.uid"
rules['slidesai_library']={'$id':{'.read':auth,'.write':f"({auth} && !data.exists() && newData.child('ownerUid').val() === auth.uid) || {slide_owner} || {admin}",'.validate':"newData.hasChildren(['id','ownerUid','created','theme']) && (!data.exists() || newData.child('ownerUid').val() === data.child('ownerUid').val())",**{k:bounded(6,262144) for k in ['theme','icons','iconsBySlide','scenes']},**{k:string(4096) for k in ['id','name','mood','prompt','model','ownerUid']},'created':number(),'keywords':array(string(40),8),'$other':{'.validate':False}}}
rules['slidesai_index']={'.read':public_query,'.indexOn':['created'],'$id':{'.write':f"({auth} && !data.exists() && newData.child('ownerUid').val() === auth.uid) || {slide_owner} || {admin}",**metadata}}
rules['art_museum']={'$id':{'.read':auth,'.write':f"({auth} && !data.exists() && newData.child('publisherUid').val() === auth.uid && root.child('art_rooms').child(newData.child('roomId').val()).child('owner').val() === auth.uid) || {museum_owner} || {admin}",'.validate':"newData.hasChildren(['publisherUid','created','name','roomId']) && (!data.exists() || newData.child('publisherUid').val() === data.child('publisherUid').val())",**{k:string(120) for k in ['name','mode','publisherUid','publisherName','remixOfMuseumId','remixOfName','roomId']},'infinite':boolean(),'remixable':boolean(),'created':number(),'views':number(),'thumbnail':metadata['thumbnail'],'snapshot':{'cells':{'$pixel':string(7)},'$other':{'.validate':False}},'$other':{'.validate':False}}}
rules['art_museum_index']={'.read':public_query,'.indexOn':['created'],'$id':{'.write':f"({auth} && !data.exists() && newData.child('publisherUid').val() === auth.uid) || {museum_owner} || {admin}",**metadata,'views':{'.read':auth,'.write':auth+' && data.parent().exists()', '.validate':'newData.isNumber() && (!data.parent().exists() ? newData.val() === 0 : newData.val() === (data.exists() ? data.val() : 0) + 1)'}}}
rules['art_museum_likes']={'$id':{'$uid':{'.read':own,'.write':own+" && root.child('art_museum').child($id).exists()",'.validate':'newData.val() === true'}}}
# Validate metadata against the same atomic write's full item, preventing forged
# ownership or index-only public junk. Metadata reads remain strictly bounded.
for collection, detail, field in [('slidesai_index','slidesai_library','ownerUid'),('art_museum_index','art_museum','publisherUid')]:
    rules[collection]['$id']['.validate'] = f"newData.parent().parent().child('{detail}').child($id).child('{field}').val() === newData.child('{field}').val() && newData.child('created').isNumber()"
rules['conversation_index']['$uid']['$kind']['$id']['.validate'] = "$kind.matches(/^(playground|image_ai|image_gen|research)$/) && newData.child('updated').isNumber()"
# SiloAI dashboard references are owner-private, small, and contain no crawl payloads.
rules['siloai_users'] = {'$uid': {
    '.read': own,
    '.write': own,
    'sites': {'$siteId': {
        '.validate': "$siteId.matches(/^[a-f0-9]{24}$/) && newData.hasChildren(['domain','createdAt'])",
        'domain': string(253),
        'createdAt': number(),
        '$other': {'.validate': False}
    }},
    '$other': {'.validate': False}
}}
# Presence writes may not exceed 5 Hz per UID. Client sends at most 4 Hz.
rules['art_presence']['$room']['$uid']['.write'] += " && (!data.exists() || !newData.exists() || newData.child('ts').val() >= data.child('ts').val() + 200)"
# Chat cooldown is checked against old state and must be advanced atomically.
last = "root.child('art_chat_last').child($room).child(auth.uid)"
new_last = "newData.parent().parent().parent().child('art_chat_last').child($room).child(auth.uid)"
rules['art_chat']['$room']['$message']['.write'] += f" && (!{last}.exists() || {last}.val() <= now - 1000) && {new_last}.val() === now"
rules['art_chat_last'] = {'$room': {'$uid': {'.write': member + ' && auth.uid === $uid', '.validate': 'newData.val() === now && (!data.exists() || data.val() <= now - 1000)'}}}
# Count one view per authenticated UID rather than unlimited public increments.
rules['art_museum_views'] = {'$id': {'$uid': {'.write': own + " && !data.exists() && root.child('art_museum').child($id).exists()", '.validate': 'newData.val() === true'}}}
rules['art_museum_index']['$id']['views']['.write'] = auth + " && data.parent().exists() && !root.child('art_museum_views').child($id).child(auth.uid).exists() && newData.parent().parent().parent().child('art_museum_views').child($id).child(auth.uid).val() === true"
# Like flags and count move together, with a per-user per-piece cooldown.
old_like = "root.child('art_museum_likes').child($id).child(auth.uid).exists()"
new_like = "newData.parent().parent().parent().child('art_museum_likes').child($id).child(auth.uid).exists()"
old_last = "root.child('art_museum_like_last').child($id).child(auth.uid)"
new_last_like = "newData.parent().parent().parent().child('art_museum_like_last').child($id).child(auth.uid)"
change = f"(!{old_like} && {new_like} && newData.val() === (data.exists() ? data.val() : 0) + 1) || ({old_like} && !{new_like} && newData.val() === data.val() - 1)"
rules['art_museum_index']['$id']['likeCount'] = {'.write': auth + f" && data.parent().exists() && (!{old_last}.exists() || {old_last}.val() <= now - 1000) && {new_last_like}.val() === now", '.validate': 'newData.isNumber() && newData.val() >= 0 && (' + change + ')'}
# The index counter rule enforces the atomic pair; direct flag writes may not diverge.
like_root = "newData.parent().parent().parent()"
old_count = "root.child('art_museum_index').child($id).child('likeCount')"
new_count = like_root + ".child('art_museum_index').child($id).child('likeCount').val()"
rules['art_museum_likes']['$id']['$uid']['.write'] += f" && (!{old_last}.exists() || {old_last}.val() <= now - 1000) && {like_root}.child('art_museum_like_last').child($id).child(auth.uid).val() === now && ((!data.exists() && newData.exists() && {new_count} === ({old_count}.exists() ? {old_count}.val() : 0) + 1) || (data.exists() && !newData.exists() && {new_count} === {old_count}.val() - 1))"
rules['art_museum_like_last'] = {'$id': {'$uid': {'.write': own + " && root.child('art_museum').child($id).exists()", '.validate': 'newData.val() === now && (!data.exists() || data.val() <= now - 1000)'}}}
rules['slidesai_library']['$id']['.validate'] += " && newData.child('id').val() === $id"
# IDs are inserted into legacy DOM handlers; disallow markup in all item keys.
for node in [rules['users']['$uid']['conversations']['$id'],rules['image_ai_conversations']['$uid']['$id'],rules['image_gen_conversations']['$uid']['$id'],rules['research_users']['$uid']['sessions']['$id'],rules['conversation_index']['$uid']['$kind']['$id'],rules['slidesai_library']['$id'],rules['slidesai_index']['$id'],rules['art_museum']['$id'],rules['art_museum_index']['$id']]:
    node['.validate'] = "$id.matches(/^[A-Za-z0-9_-]{1,128}$/) && (" + node.get('.validate','true') + ")"
rules['art_user_rooms']['$uid']['.read'] = own + " && query.orderByKey && query.limitToLast != null && query.limitToLast <= 50"
Path(__file__).with_name('database.rules.json').write_text(json.dumps({'rules':rules},indent=2)+'\n')
