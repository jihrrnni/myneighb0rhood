const http=require("http"),fs=require("fs"),path=require("path");
const {URL}=require("url");
const PORT=process.env.PORT||3000;
const ROOT=path.join(__dirname,"public");
const UA="MyNeighborhood/1.0 (personal music collage project; contact: my-neighborhood@example.com)";
let lastMB=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function mb(url){
  const gap=Date.now()-lastMB;
  if(gap<1000) await wait(1000-gap);
  lastMB=Date.now();
  const r=await fetch(url,{headers:{"User-Agent":UA,"Accept":"application/json"}});
  if(!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
  return r.json();
}
function json(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,`http://${req.headers.host}`);

  // Search artists first. This avoids the fragile "artist + primarytype" release-group query.
  if(u.pathname==="/api/artists"){
    const q=(u.searchParams.get("q")||"").trim();
    if(!q)return json(res,400,{error:"検索語を入力してください"});
    if(q.length>100)return json(res,400,{error:"検索語が長すぎます"});
    const api="https://musicbrainz.org/ws/2/artist/?query="+encodeURIComponent(q)+"&limit=8&fmt=json";
    const d=await mb(api);
    const artists=(d.artists||[]).map(a=>({id:a.id,name:a.name,sortName:a["sort-name"]||a.name,country:a.country||""}));
    return json(res,200,{artists});
  }

  // Fetch album release-groups by artist using the MusicBrainz browse endpoint.
  // This is more reliable than loading linked release-groups from the artist lookup,
  // which is limited to 25 linked entities.
  if(u.pathname==="/api/albums"){
    const id=u.searchParams.get("id");
    if(!/^[0-9a-f-]{36}$/i.test(id||""))return json(res,400,{error:"不正なアーティストIDです"});

    const all=[];
    for(let offset=0; offset<300; offset+=100){
      const api=`https://musicbrainz.org/ws/2/release-group/?artist=${encodeURIComponent(id)}&type=album&limit=100&offset=${offset}&fmt=json`;
      const d=await mb(api);
      const rows=d["release-groups"]||d["release-group-list"]||[];
      all.push(...rows);
      const count=Number(d.count||0);
      if(!rows.length || offset+rows.length>=count)break;
    }

    const seen=new Set();
    const albums=all
      .filter(x=>{
        const primary=x["primary-type"]||x.type||"";
        return String(primary).toLowerCase()==="album";
      })
      .filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;})
      .sort((a,b)=>(b["first-release-date"]||"").localeCompare(a["first-release-date"]||""))
      .map(x=>({id:x.id,title:x.title,date:x["first-release-date"]||""}));

    return json(res,200,{albums});
  }

  if(u.pathname==="/api/cover"){
    const id=u.searchParams.get("id");
    if(!/^[0-9a-f-]{36}$/i.test(id||""))return json(res,400,{error:"不正なアルバムIDです"});
    const r=await fetch(`https://coverartarchive.org/release-group/${id}`,{headers:{"Accept":"application/json"}});
    if(!r.ok)return json(res,r.status,{error:"このアルバムのジャケットが見つかりません"});
    const d=await r.json(), img=(d.images||[]).find(x=>x.front)||(d.images||[])[0];
    if(!img)return json(res,404,{error:"ジャケットがありません"});
    const imageUrl=img.thumbnails?.["500"]||img.thumbnails?.["250"]||img.image;
    const ir=await fetch(imageUrl,{headers:{"User-Agent":UA}});
    if(!ir.ok)return json(res,502,{error:"ジャケット画像の取得に失敗しました"});
    const type=ir.headers.get("content-type")||"image/jpeg";
    const buf=Buffer.from(await ir.arrayBuffer());
    return json(res,200,{image:`data:${type};base64,${buf.toString("base64")}`});
  }

  let file=u.pathname==="/" ? path.join(ROOT,"index.html") : path.normalize(path.join(ROOT,u.pathname));
  if(!file.startsWith(ROOT))return json(res,403,{error:"forbidden"});
  if(fs.existsSync(file)&&fs.statSync(file).isFile()){
    const ext=path.extname(file), types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});return res.end(fs.readFileSync(file));
  }
  json(res,404,{error:"not found"});
 }catch(e){console.error(e);json(res,502,{error:"MusicBrainzへの接続に失敗しました。サーバーを起動した状態で、もう一度試してください。"});}
});
server.listen(PORT,()=>console.log(`My neighborhood → http://localhost:${PORT}`));
