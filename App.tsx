import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createClient } from "@supabase/supabase-js";

type Comment = { id: string; userId: string; content: string; createdAt: number; replies: Comment[]; likesUp: string[]; likesDown: string[]; edited?: boolean; };
type Post = { id: string; userId: string; caption: string; createdAt: number; media_urls: string[]; mediaTypes: ("image"|"video")[]; comments: Comment[]; likesUp: string[]; likesDown: string[]; edited?: boolean; };

const classNames = (...a: (string|false|undefined)[]) => a.filter(Boolean).join(" ");
const uid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const timeAgo = (ts:number) => { const s=Math.floor((Date.now()-ts)/1000); if(s<60) return `${s}s`; const m=Math.floor(s/60); if(m<60) return `${m}m`; const h=Math.floor(m/60); if(h<24) return `${h}h`; const d=Math.floor(h/24); if(d<7) return `${d}d`; return new Date(ts).toLocaleDateString(); };

function useToast(){ const [toast, setToast] = useState<string|null>(null); const t = useRef<number|undefined>(undefined); const showToast=(msg:string,ms=2000)=>{ setToast(msg); if(t.current) window.clearTimeout(t.current); t.current=window.setTimeout(()=>setToast(null),ms); }; useEffect(()=>()=>{ if(t.current) window.clearTimeout(t.current); },[]); return { toast, showToast }; }
function Toast({ msg }:{ msg:string }){ return <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-4 py-2 rounded-xl shadow z-50">{msg}</div>; }

// Bump this each time App.tsx changes (for cache-busting on Vercel)
const APP_VERSION = 'v0.8';

type Profile = { id: string; username: string; bio?: string; email?: string };

type DataLayer = {
  mode: 'supabase'|'local';
  currentUser: { id:string, email?:string } | null;
  isAdmin: boolean;
  signIn(p:{ identifier:string, password:string }): Promise<void>;
  signUp(p:{ email:string, password:string, username?:string, bio?:string }): Promise<void>;
  signOut(): Promise<void>;
  listPosts(): Promise<Post[]>;
  getProfile(id:string): Promise<Profile | null>;
  updateProfile(p:{ username: string; bio?: string }): Promise<void>;
  addComment(p:{ postId:string, content:string }): Promise<void>;
  addReply?(p:{ postId:string, commentId:string, content:string }): Promise<void>;
  updatePost(p:{ postId:string, caption:string }): Promise<void>;
  deletePost(p:{ postId:string }): Promise<void>;
  toggleReactPost(p:{ postId:string, type:'up'|'down' }): Promise<void>;
  createPost(p:{ files: File[], caption: string }): Promise<void>;
  deleteAllPostsByUser?(userId:string): Promise<void>;
  subscribe?(onChange:()=>void): ()=>void;
  seed?():void;
};

function useDataLayer(){
  const [layer,setLayer] = useState<DataLayer|null>(null);
  useLayoutEffect(()=>{
    let unsub: undefined | (()=>void);
    (async()=>{
      const url = import.meta.env.VITE_SUPABASE_URL as string|undefined;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
      const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string|undefined;
      if(url && anon){
        const sb = createClient(url, anon);
        setLayer(await createSupabaseLayer(sb, adminEmail));
        const { data } = sb.auth.onAuthStateChange(async ()=>{
          setLayer(await createSupabaseLayer(sb, adminEmail));
        });
        unsub = () => data.subscription.unsubscribe();
      } else {
        setLayer(createLocalLayer());
      }
    })();
    return () => { if (unsub) unsub(); };
  },[]);
  return layer;
}

async function createSupabaseLayer(supabase:any, adminEmail?:string): Promise<DataLayer>{
  const getUser = async ()=>{ const { data } = await supabase.auth.getUser(); return data?.user||null; };
  const user = await getUser();
  const isAdmin = !!(user?.email && adminEmail && user.email.toLowerCase()===adminEmail.toLowerCase());
  const bucket = import.meta.env.VITE_SUPABASE_BUCKET || 'media';
  const cache = new Map<string, any>();
  const _getProfile = async (id:string) => {
    if (cache.has(id)) return cache.get(id);
    const { data } = await supabase.from('profiles').select('id, username, bio, email').eq('id', id).maybeSingle();
    if (data) cache.set(id, data);
    return data;
  };
  return {
    mode:'supabase',
    currentUser: user? { id:user.id, email:user.email }: null,
    isAdmin,
    async signIn({ identifier, password }){
      const isEmail = /.+@.+\..+/.test(identifier);
      let email = identifier;
      if (!isEmail){
        const { data, error } = await supabase.from('profiles').select('email').eq('username', identifier).maybeSingle();
        if (error || !data?.email) throw new Error('Username not found');
        email = data.email;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp({ email, password, username, bio }){ const { data, error } = await supabase.auth.signUp({ email, password }); if (error) throw error; const u = data.user || (await getUser()); if (!u) return; if (username){ const { error: e2 } = await supabase.from('profiles').upsert({ id: u.id, username, bio: bio||'', email }, { onConflict: 'id' }); if (e2) throw e2; } },
    async signOut(){ await supabase.auth.signOut(); },async listPosts(){
      const { data: posts, error: e1 } = await supabase.from('posts').select('*').order('created_at',{ascending:false}).limit(50);
      if (e1) throw e1;
      if (!posts?.length) return [] as Post[];
      const postIds = posts.map((p:any)=>p.id);
      const { data: comments, error: e2 } = await supabase.from('comments').select('*').in('post_id', postIds).order('created_at',{ascending:true});
      if (e2) throw e2;
      const byPost = new Map<string, Comment[]>();
      const byId = new Map<string, (Comment & { postId?: string; parentId?: string|null })>();
      (comments||[]).forEach((row:any)=>{
        const m = typeof row.content==="string" && row.content.match(/^\[reply:([^\]]+)\]\s*/);


        const parentId = (row.parent_id as string|undefined) || (m? m[1] : null);
        const content = m? row.content.replace(/^\[reply:[^\]]+\]\s*/,'') : row.content;
        const c: (Comment & { postId?: string; parentId?: string|null }) = {
          id:row.id, userId:row.user_id, content, createdAt:new Date(row.created_at).getTime(), replies:[], likesUp:row.likes_up||[], likesDown:row.likes_down||[], edited: !!row.edited,
          postId: row.post_id, parentId
        };
        byId.set(c.id, c);
      });
      byId.forEach((c)=>{
        if (c.parentId && byId.has(c.parentId)) {
          byId.get(c.parentId)!.replies.push(c);
        } else {
          const arr = byPost.get(c.postId!) || [];
          arr.push(c);
          byPost.set(c.postId!, arr);
        }
      });
      return posts.map((p:any)=>({ id:p.id, userId:p.user_id, caption:p.caption, createdAt:new Date(p.created_at).getTime(), media_urls:p.media_urls||[], mediaTypes:p.media_types||[], comments: byPost.get(p.id)||[], likesUp:p.likes_up||[], likesDown:p.likes_down||[], edited: !!p.edited }));
    },
    async getProfile(id:string){ return await _getProfile(id); },
    async updateProfile({ username, bio }){
      const u = await getUser();
      if (!u) throw new Error('Login required');
      const { error } = await supabase.from('profiles')
        .upsert({ id: u.id, username, bio: bio||'', email: u.email }, { onConflict: 'id' });
      if (error) throw error;
      cache.delete(u.id);
    },
    async createPost({ files, caption }){
      const u = await getUser();
      if (!u) throw new Error('Login required');
      const media_urls: string[] = [];
      const media_types: ("image"|"video")[] = [];
      let idx = 0;
      for (const file of files){
        if (!file) continue;
        const isVideo = file.type.startsWith('video');
        const path = `${u.id}/${Date.now()}_${idx++}.${isVideo? (file.name.split('.').pop()||'mp4') : (file.name.split('.').pop()||'jpg')}`;
        const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        media_urls.push(data.publicUrl);
        media_types.push(isVideo? 'video':'image');
      }
      const { error } = await supabase.from('posts').insert({ caption, media_urls, media_types });
      if (error) throw error;
    },
    async addComment({ postId, content }){
      const u = await getUser();
      if (!u) throw new Error('Login required');
      const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: u.id, content });
      if (error) throw error;
    },
     async addReply({ postId, commentId, content }){
       const u = await getUser();
       if (!u) throw new Error("Login required");
       const withParent:any = { post_id: postId, parent_id: commentId, user_id: u.id, content: `[reply:${commentId}] ${content}` };
       let { error } = await supabase.from("comments").insert(withParent);
       if (error) {
         const { error: e2 } = await supabase.from("comments").insert({ post_id: postId, user_id: u.id, content: `[reply:${commentId}] ${content}` });
         if (e2) throw e2;
       }
     },
    async updatePost({ postId, caption }){
      const { error } = await supabase.from('posts').update({ caption, edited:true }).eq('id', postId);
      if (error) throw error;
    },
    async deletePost({ postId }){
      const { error } = await supabase.from('posts').delete().eq('id', postId);
      if (error) throw error;
    },
    async toggleReactPost({ postId, type }){
      const { data, error } = await supabase.from('posts').select('likes_up, likes_down').eq('id', postId).single();
      if (error) throw error;
      const u = await getUser();
      const userId = u?.id; if (!userId) return;
      const up = new Set<string>(data?.likes_up||[]), down = new Set<string>(data?.likes_down||[]);
      if (type==='up'){ up.has(userId)? up.delete(userId):(up.add(userId), down.delete(userId)); } else { down.has(userId)? down.delete(userId):(down.add(userId), up.delete(userId)); }
      const { error: e2 } = await supabase.from('posts').update({ likes_up:[...up], likes_down:[...down] }).eq('id', postId);
      if (e2) throw e2;
    },
    async deleteAllPostsByUser(userId:string){
      const { error } = await supabase.from('posts').delete().eq('user_id', userId);
      if (error) throw error;
    },
    subscribe(onChange){
      const ch = supabase.channel('realtime:instafacts')
        .on('postgres_changes', { event:'*', schema:'public', table:'posts' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'comments' }, onChange)
        .subscribe();
      return ()=>{ supabase.removeChannel(ch); };
    },
  };
}

function createLocalLayer(): DataLayer{
  const state = {
    currentUser: null as { id:string, email?:string } | null,
    posts: [] as Post[],
    profiles: new Map<string, Profile>()
  };
  return {
    mode:'local',
    currentUser: state.currentUser,
    isAdmin: true,
    async signIn({ identifier }){
      const id = identifier || 'user_local';
      state.currentUser = { id, email: identifier && identifier.indexOf('@')>0 ? identifier : undefined };
      if (!state.profiles.has(id)) state.profiles.set(id, { id, username: id, bio:'', email: state.currentUser.email });
    },
    async signUp({ email, username, bio }){
      const id = username || email || 'user_local';
      state.currentUser = { id, email };
      state.profiles.set(id, { id, username: username||id, bio: bio||'', email });
    },
    async signOut(){ state.currentUser = null; },
    async listPosts(){ return state.posts; },
    async getProfile(id:string){ return state.profiles.get(id) || { id, username:id, bio:'' }; },
    async updateProfile({ username, bio }){
      const u = await getUser();
      if (!u) throw new Error('Login required');
      const { error } = await supabase.from('profiles')
        .upsert({ id: u.id, username, bio: bio||'', email: u.email }, { onConflict: 'id' });
      if (error) throw error;
      cache.delete(u.id);
    },
    async createPost({ files, caption }){ const urls: string[] = []; const types: ("image"|"video")[] = []; for (const f of files){ if (!f) continue; const isVideo = f.type.startsWith('video'); urls.push(URL.createObjectURL(f)); types.push(isVideo? 'video':'image'); } state.posts = [{ id:uid('p'), userId: state.currentUser?.id||'user_local', caption, createdAt: Date.now(), media_urls: urls, mediaTypes: types, comments:[], likesUp:[], likesDown:[], edited:false }, ...state.posts ]; },
    async addComment({ postId, content }){ state.posts = state.posts.map(p=> p.id===postId? { ...p, comments:[...p.comments, { id:uid('c'), userId: state.currentUser?.id||'user_local', content, createdAt:Date.now(), replies:[], likesUp:[], likesDown:[] } ] } : p ); },
    async updatePost({ postId, caption }){ state.posts = state.posts.map(p=> p.id===postId? { ...p, caption, edited:true } : p ); },
     async addReply({ postId, commentId, content }){
       state.posts = state.posts.map(p => {
         if (p.id !== postId) return p;
         return { ...p, comments: p.comments.map(cm => cm.id===commentId ? { ...cm, replies:[...cm.replies, { id:uid('rc'), userId: state.currentUser?.id||'user_local', content, createdAt:Date.now(), replies:[], likesUp:[], likesDown:[] }] } : cm) };
       });
     },
    async deletePost({ postId }){ state.posts = state.posts.filter(p=>p.id!==postId); },
    async toggleReactPost(){},
    async deleteAllPostsByUser(userId:string){ state.posts = state.posts.filter(p=>p.userId!==userId); },
    seed(){
      state.profiles.set('alice', { id:'alice', username:'alice', bio:'' });
      state.profiles.set('bob', { id:'bob', username:'bob', bio:'' });
      state.posts = [
        { id:uid('p'), userId:'alice', caption:'Hello Supabase ??', createdAt:Date.now()-60000, media_urls:[], mediaTypes:[], comments:[], likesUp:[], likesDown:[], edited:false},
        { id:uid('p'), userId:'bob', caption:'Second post', createdAt:Date.now()-3600000, media_urls:[], mediaTypes:[], comments:[], likesUp:[], likesDown:[], edited:false},
      ];
    }
  };
}function App(){
  const data = useDataLayer();
  const [route, setRoute] = useState<string>(()=>parseHash());
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const { toast, showToast } = useToast();
  useEffect(()=>{ const onHash=()=>setRoute(parseHash()); window.addEventListener('hashchange', onHash); return ()=>window.removeEventListener('hashchange', onHash); },[]);
  useEffect(()=>{ if(!data) return; if (data.mode==='local') data.seed?.(); refresh(); const unsub = data.subscribe? data.subscribe(()=>refresh()): undefined; return ()=>{ unsub && unsub(); }; },[data]);
  const isAuthed = !!data?.currentUser;
  const isAdmin = !!data?.isAdmin;

  async function refresh(){ if(!data) return; try { setLoading(true); const list = await data.listPosts(); setPosts(list); } catch(e:any){ showToast('Failed to load posts'); } finally { setLoading(false);} }

  const niceAuthError = (e:any) => { const m = String(e?.message || e || '').toLowerCase(); if (m.includes('invalid login') || m.includes('invalid email') || m.includes('invalid credentials')) return 'Invalid email/username or password.'; if (m.includes('registered') || m.includes('already exists')) return 'Email already in use. Please sign in.'; if (m.includes('confirm')) return 'Check your email to confirm your account, then sign in.'; return e?.message || 'Authentication failed.'; };
  const doSignIn = async ({ identifier, password }:{ identifier:string, password:string })=>{ try { await data?.signIn({ identifier, password }); window.location.hash = '#/profile'; refresh(); } catch(e:any){ showToast(niceAuthError(e)); } };
  const doSignUp = async ({ email, password, username, bio }:{ email:string, password:string, username?:string, bio?:string })=>{ try { await data?.signUp({ email, password, username, bio }); window.location.hash = '#/profile'; refresh(); } catch(e:any){ showToast(niceAuthError(e)); } };
  const doSignOut = async ()=>{
    try {
      await data?.signOut();
    } catch {}
    try {
      for (const k in localStorage) {
        if (typeof k === 'string' && k.startsWith('sb-') && k.endsWith('-auth-token')) {
          try { localStorage.removeItem(k as any); } catch {}
        }
      }
      sessionStorage.removeItem('instafacts_cache');
    } catch {}
    window.location.hash = '#/login';
    window.location.reload();
  };

  const onAddComment = async (postId:string, content:string)=>{ try { await data?.addComment({ postId, content }); refresh(); } catch(e:any){ showToast('Failed to add comment'); } };
  const onAddReply = async (postId:string, commentId:string, content:string)=>{ try { await (data as any)?.addReply?.({ postId, commentId, content }); refresh(); } catch(e:any){ showToast('Failed to add reply'); } };
  const onEditPost   = async (postId:string, caption:string)=>{ try { await data?.updatePost({ postId, caption }); refresh(); } catch(e:any){ showToast('Failed to update'); } };
  const onDeletePost = async (postId:string)=>{ try { await data?.deletePost({ postId }); refresh(); } catch(e:any){ showToast('Failed to delete'); } };
  const onReactPost  = async (postId:string, type:'up'|'down')=>{ try { await data?.toggleReactPost({ postId, type }); refresh(); } catch(e:any){ showToast('Failed to react'); } };
  const deleteAllByUser = async (userId:string)=>{ try { await data?.deleteAllPostsByUser?.(userId); refresh(); } catch(e:any){ showToast('Admin policy not configured'); } };

// Create post helper
const onCreatePost = async (files: File[], caption: string) => {
  try {
    await data?.createPost({ files, caption });
    window.location.hash = '#/home';
    refresh();
    showToast('Posted');
  } catch (e:any) {
    showToast(e.message || 'Failed to post');
  }
};

// Derive display name (prefer username)
  useEffect(()=>{ let cancelled=false; (async()=>{
    const id = data?.currentUser?.id;
    if (id && data?.getProfile){
      try { const p = await data.getProfile(id); if(!cancelled) setDisplayName(p?.username || data.currentUser?.email || undefined); } catch { setDisplayName(data?.currentUser?.email); }
    } else { setDisplayName(undefined); }
  })(); return ()=>{ cancelled=true; }; }, [data?.currentUser?.id]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <TopBar currentUserLabel={(displayName || data?.currentUser?.email)} onSignOut={doSignOut} />
      <div className="max-w-5xl mx-auto px-4 pb-24">
        {toast && <Toast msg={toast} />}
        {route==='login' && !isAuthed && <div className="max-w-md mx-auto"><LoginCard onSignIn={doSignIn} onSignUp={doSignUp} /></div>}
        {route==='new' && isAuthed && <div className="max-w-md mx-auto"><NewPost onCreate={onCreatePost} /></div>}
        {route==='profile' && isAuthed && (
          <div className="max-w-md mx-auto mt-4">
            <ProfileEditor
              loadProfile={async()=> (data ? await data.getProfile(data.currentUser!.id) : null)}
              onSave={async (p)=>{ try { await data?.updateProfile(p); showToast('Profile saved'); window.location.hash = '#/home'; refresh(); } catch(e:any){ showToast(e.message||'Save failed'); } }}
            />
          </div>
        )}
        {route==='home' && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,680px)_320px] gap-8 mt-4">
            <div>
              {isAdmin && posts.length>0 && (
                <AdminPanel posts={posts} onDeleteAll={deleteAllByUser} />
              )}
              {loading ? <FeedSkeleton /> : (
                <HomeFeed posts={posts} getUser={(id)=>data?.getProfile(id)} onAddReply={onAddReply}
                  onAddComment={onAddComment} onReactPost={onReactPost}
                  isAuthed={isAuthed} currentUserId={data?.currentUser?.id||''}
                  onEditPost={onEditPost} onDeletePost={onDeletePost}
                />
              )}
            </div>
            <aside className="hidden lg:block">
              <RightRail />
            </aside>
          </div>
        )}
      </div>
      <MobileTabbar isAuthed={isAuthed} />
      <Footer />
    </div>
  );
}

function parseHash(){ const raw=window.location.hash.replace(/^#\/?/,''); if(!raw) return 'home'; if(['home','login','new','profile'].includes(raw)) return raw; return 'home'; }

function TopBar({ currentUserLabel, onSignOut }:{ currentUserLabel?: string, onSignOut: ()=>void }){
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-neutral-200">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between">
        <a href="#/home" className="flex items-center gap-2 hover:opacity-90">
          <Logo size={26} />
          <span className="hidden sm:block font-semibold tracking-tight">InstaFacts</span>
        </a>
        <div className="flex items-center gap-3 text-sm">
          <a href="#/home" aria-label="Home" className="p-1.5 rounded-xl hover:bg-neutral-100"><HomeIcon/></a>
          <a href="#/new" aria-label="New" className="p-1.5 rounded-xl hover:bg-neutral-100"><AddIcon/></a>
          <a href="#/profile" aria-label="Profile" className="p-1.5 rounded-xl hover:bg-neutral-100"><UserIcon/></a>
          {currentUserLabel ? (
            <>
              <span className="px-2 text-neutral-600 hidden sm:block">{currentUserLabel}</span>
              <button onClick={onSignOut} className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white hover:opacity-90">Log out</button>
            </>
          ) : (
            <a href="#/login" className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white">Log in</a>
          )}
          <span className="ml-2 text-xs text-neutral-500">{APP_VERSION}</span>
        </div>
      </div>
    </header>
  );
}

function Logo({ size = 28 }:{ size?: number }){
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="InstaFacts" style={{ display:'block' }}>
      <defs>
        <linearGradient id="igG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f58529" />
          <stop offset="50%" stopColor="#dd2a7b" />
          <stop offset="100%" stopColor="#8134af" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="22" fill="url(#igG)" />
      <circle cx="45" cy="45" r="18" fill="none" stroke="#fff" strokeWidth="8" />
      <line x1="58" y1="58" x2="75" y2="75" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

function LoginCard({ onSignIn, onSignUp }:{ onSignIn:(p:{identifier:string,password:string})=>void, onSignUp:(p:{email:string,password:string,username?:string,bio?:string})=>void }){
  const [mode,setMode]=useState<'signin'|'signup'>('signin');
  const [identifier,setIdentifier]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [username,setUsername]=useState('');
  const [bio,setBio]=useState('');
  const [showPwd,setShowPwd]=useState(false);
  const [err,setErr] = useState('');
  const isEmail=(v:string)=>/.+@.+\..+/.test(v);
  const submit=()=>{
    setErr('');
    if (mode==='signin'){
      if(!identifier){ setErr('Enter email or username'); return; }
      if(!password){ setErr('Password required'); return; }
      onSignIn({ identifier, password });
      return;
    }
    if (!isEmail(email)) { setErr('Please enter a valid email address'); return; }
    if (!password) { setErr('Password is required'); return; }
    if (!username) { setErr('Choose a username'); return; }
    onSignUp({ email, password, username, bio });
  };
  const onKeyDown=(e:React.KeyboardEvent)=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } };
  return (
    <div className="mt-12 bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between mb-4">
        <Logo/>
        <div className="flex gap-2 text-sm">
          <button className={classNames('px-3 py-1.5 rounded-xl', mode==='signin'? 'bg-neutral-900 text-white':'bg-neutral-100')} onClick={()=>setMode('signin')}>Sign in</button>
          <button className={classNames('px-3 py-1.5 rounded-xl', mode==='signup'? 'bg-neutral-900 text-white':'bg-neutral-100')} onClick={()=>setMode('signup')}>Create account</button>
        </div>
      </div>
      {mode==='signin' ? (
        <div className="grid gap-3">
          <label className="text-sm">Email or Username
            <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="you@example.com or username"/>
          </label>
          <label className="text-sm">Password
            <div className="mt-1 flex items-center gap-2">
              <input className="flex-1 border border-neutral-300 rounded-xl px-3 py-2" type={showPwd? 'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}/>
              <button type="button" className="text-xs px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>setShowPwd(s=>!s)}>{showPwd? 'Hide':'Show'}</button>
            </div>
          </label>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex items-center gap-2 mt-2">
            <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Log in</button>
          </div>
        </div>
      ):(
        <div className="grid gap-3">
          <label className="text-sm">Email address
            <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          </label>
          <label className="text-sm">Password
            <div className="mt-1 flex items-center gap-2">
              <input className="flex-1 border border-neutral-300 rounded-xl px-3 py-2" type={showPwd? 'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}/>
              <button type="button" className="text-xs px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>setShowPwd(s=>!s)}>{showPwd? 'Hide':'Show'}</button>
            </div>
          </label>
          <label className="text-sm">Username
            <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)} placeholder="yourname"/>
          </label>
          <label className="text-sm">Bio
            <textarea className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" rows={2} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell something about yourself"/>
          </label>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex items-center gap-2 mt-2">
            <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Create account</button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-500">Sign in with your email or username. Usernames are unique.</p>
    </div>
  );
}function NewPost({ onCreate }:{ onCreate:(files: File[], caption: string)=>void }){
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [cropIndex, setCropIndex] = useState<number|null>(null);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).filter(f=> f.type.startsWith('image') || f.type.startsWith('video'));
    if (!arr.length) return;
    setFiles(prev => [...prev, ...arr].slice(0, 9));
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>)=>{ addFiles(e.target.files); e.currentTarget.value=''; };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); addFiles(e.dataTransfer?.files||null); };
  const onDrag = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.type==='dragover') setDragActive(true); if(e.type==='dragleave') setDragActive(false); };
  const removeAt = (idx:number)=> setFiles(prev => prev.filter((_,i)=>i!==idx));
  const openCrop = (idx:number)=> setCropIndex(idx);
  const closeCrop = ()=> setCropIndex(null);
  const saveCrop = (cropped: File)=>{ if(cropIndex==null) return; setFiles(prev=> prev.map((f,i)=> i===cropIndex? cropped : f)); setCropIndex(null); };

  const submit = ()=>{ if (!files.length && !caption.trim()) return; onCreate(files, caption.trim()); };

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Create new post</h2>
        <a href="#/home" className="text-sm text-neutral-500 hover:underline">Cancel</a>
      </div>
      <div className="grid gap-3">
        <div
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrop}
          className={classNames(
            'rounded-2xl border-2 border-dashed px-4 py-10 text-center cursor-pointer transition',
            dragActive? 'border-neutral-600 bg-neutral-50':'border-neutral-300 hover:bg-neutral-50'
          )}
          onClick={()=> inputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-neutral-900 text-white flex items-center justify-center">+
            </div>
            <div className="text-sm text-neutral-700">Drag & drop images/videos here</div>
            <div className="text-xs text-neutral-500">or click to browse</div>
            <div className="text-[11px] text-neutral-400 mt-1">Up to 9 items. Images can be cropped to square.</div>
          </div>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={onPick} className="hidden" />
        </div>

        {!!files.length && (
          <div className="grid grid-cols-3 gap-2">
            {files.slice(0,9).map((f, i)=> (
              <div key={i} className="relative aspect-square bg-neutral-200 rounded-lg overflow-hidden group">
                <Preview file={f} />
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={()=>removeAt(i)} title="Remove" className="px-2 py-1 rounded-md bg-white/90 text-xs border border-neutral-300">Remove</button>
                </div>
                {f.type.startsWith('image') && (
                  <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={()=>openCrop(i)} className="px-2 py-1 rounded-md bg-white/90 text-xs border border-neutral-300">Crop</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <textarea className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm" rows={3} placeholder="Write a caption..." value={caption} onChange={e=>setCaption(e.target.value)} />
        <button onClick={submit} disabled={!files.length && !caption.trim()} className={classNames('px-4 py-2 rounded-xl text-sm', (!files.length && !caption.trim())? 'bg-neutral-200 text-neutral-500':'bg-neutral-900 text-white')}>Share</button>
      </div>

      {cropIndex!=null && files[cropIndex] && files[cropIndex].type.startsWith('image') && (
        <ImageCropperModal file={files[cropIndex]} onCancel={closeCrop} onSave={saveCrop} />
      )}
    </div>
  );
}

function ImageCropperModal({ file, onCancel, onSave }:{ file: File; onCancel:()=>void; onSave:(f:File)=>void }){
  const [url,setUrl] = useState<string>('');
  const [img,setImg] = useState<HTMLImageElement|null>(null);
  const [scale,setScale] = useState(1);
  const [minScale,setMinScale] = useState(1);
  const [pos,setPos] = useState({ x:0, y:0 });
  const [dragging,setDragging] = useState<null|{x:number;y:number}>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ const u = URL.createObjectURL(file); setUrl(u); return ()=>URL.revokeObjectURL(u); },[file]);
  useEffect(()=>{ if(!url) return; const i=new Image(); i.onload=()=>setImg(i); i.src=url; },[url]);

  const startDrag = (e: React.MouseEvent)=>{ e.preventDefault(); setDragging({ x:e.clientX - pos.x, y:e.clientY - pos.y }); };
  const onMove = (e: React.MouseEvent)=>{ if(!dragging) return; setPos({ x: e.clientX - dragging.x, y: e.clientY - dragging.y }); };
  const endDrag = ()=>{ setDragging(null); if(frameRef.current) setPos(p=> clampPosition(p, frameRef.current!.clientWidth)); };

  const clampPosition = (posIn:{x:number;y:number}, frameSize:number, s:number = scale) => { if (!img) return posIn; const iw = img.naturalWidth * s; const ih = img.naturalHeight * s;
    let x = posIn.x, y = posIn.y;
    const minX = Math.min(0, frameSize - iw);
    const maxX = Math.max(0, 0);
    const minY = Math.min(0, frameSize - ih);
    const maxY = Math.max(0, 0);
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    return { x, y };
  };
  const setScaleAt = (fx:number, fy:number, next:number) => {
    if (!frameRef.current || !img) { setScale(next); return; }
    const size = frameRef.current.clientWidth;
    const newScale = Math.max(next, minScale);
    const imgFx = (fx - pos.x) / scale;
    const imgFy = (fy - pos.y) / scale;
    let nx = fx - imgFx * newScale;
    let ny = fy - imgFy * newScale;
    const clamped = clampPosition({ x:nx, y:ny }, size, newScale);
    setScale(newScale);
    setPos(clamped);
  };
  
  const setScaleKeepingCenter = (next:number) => {
    if (!frameRef.current) { setScale(next); return; }
    const size = frameRef.current.clientWidth;
    const cx = size/2; const cy = size/2;
    setScaleAt(cx, cy, next);
  };

  useLayoutEffect(()=>{
    if(!img || !frameRef.current) return;
    const size = frameRef.current.clientWidth;
    const minS = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    setMinScale(minS);
    const useScale = Math.max(scale, minS);
    if (scale < minS) setScale(minS);
    const iw = img.naturalWidth * useScale;
    const ih = img.naturalHeight * useScale;
    setPos(clampPosition({ x:(size - iw)/2, y:(size - ih)/2 }, size, useScale));
  }, [img]);
  useEffect(()=>{
    if(!frameRef.current) return;
    setPos(p=> clampPosition(p, frameRef.current!.clientWidth));
  }, [scale]);

  const doSave = async () => {
    if (!img || !frameRef.current) return;
    const size = frameRef.current.clientWidth;
    const canvas = document.createElement('canvas');
    const outSize = 1080;
    canvas.width = outSize; canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sWidth = size / scale;
    const sHeight = size / scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,outSize,outSize);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outSize, outSize);
    canvas.toBlob((blob)=>{
      if(!blob) return;
      const name = (file.name?.replace(/\.[^.]+$/, '')||'image') + '-cropped.jpg';
      const cropped = new File([blob], name, { type:'image/jpeg' });
      onSave(cropped);
    }, 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Crop to square</h3>
          <button onClick={onCancel} className="text-sm text-neutral-600 hover:underline">Cancel</button>
        </div>
        <div
          ref={frameRef}
          className="relative w-full" style={{ paddingTop:'100%' }}
        >
          <div
            className="absolute inset-0 bg-neutral-900 overflow-hidden cursor-grab active:cursor-grabbing" onMouseDown={startDrag} onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={endDrag} onWheel={(e)=>{ e.preventDefault(); if(!frameRef.current) return; const r = frameRef.current.getBoundingClientRect(); const fx = e.clientX - r.left; const fy = e.clientY - r.top; const factor = e.deltaY < 0 ? 1.1 : 0.9; setScaleAt(fx, fy, scale * factor); }} onDoubleClick={(e)=>{ if(!frameRef.current) return; const r = frameRef.current.getBoundingClientRect(); const fx = e.clientX - r.left; const fy = e.clientY - r.top; const target = scale < Math.max(minScale*1.5, minScale + 0.2) ? Math.max(minScale*2, scale*1.5) : minScale; setScaleAt(fx, fy, target); }}
          >
            {!!img && (
              <img
                src={url}
                alt="Crop"
                draggable={false}
                style={{ position:'absolute', left: 0, top: 0, width: img?.naturalWidth||0, height: img?.naturalHeight||0, transform: "translate(" + pos.x + "px, " + pos.y + "px) scale(" + scale + ")", transformOrigin:'top left', userSelect:'none' }}
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label className="text-xs text-neutral-600">Zoom</label>
          <input type="range" min={minScale} max={Math.max(minScale, 3)} step={0.01} value={scale} onChange={e=>setScaleKeepingCenter(parseFloat(e.target.value))} className="flex-1" />
          <button onClick={doSave} className="px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm">Save</button>
        </div>
      </div>
    </div>
  );
}

function Preview({ file }:{ file: File }){
  const [url,setUrl] = useState<string>('');
  useEffect(()=>{ const u = URL.createObjectURL(file); setUrl(u); return ()=>URL.revokeObjectURL(u); },[file]);
  if (file.type.startsWith('video')) return <video src={url} className="w-full h-full object-cover" />;
  return <img src={url} alt="preview" className="w-full h-full object-cover" />;
}

function AdminPanel({ posts, onDeleteAll }:{ posts:Post[], onDeleteAll:(userId:string)=>void }){
  const users = Array.from(new Set(posts.map(p=>p.userId)));
  const [target, setTarget] = useState(users[0]||'');
  return (
    <div className="mt-4 mb-2 p-3 border border-red-300 rounded-xl bg-red-50 text-sm">
      <div className="flex items-center gap-2">
        <strong className="text-red-700">Admin</strong>
        <select className="border border-neutral-300 rounded-lg px-2 py-1" value={target} onChange={e=>setTarget(e.target.value)}>
          {users.map(u=> <option key={u} value={u}>{u}</option>)}
        </select>
        <button className="ml-auto px-3 py-1.5 rounded-lg bg-red-600 text-white" onClick={()=>target && onDeleteAll(target)}>Delete all posts by user</button>
      </div>
    </div>
  );
}

function HomeFeed({ posts, getUser, onAddComment, onAddReply, onReactPost, isAuthed, currentUserId, onEditPost, onDeletePost }:{
  posts: Post[];
  getUser: (id:string)=>any;
  onAddComment: (postId:string, content:string)=>void;
  onAddReply: (postId:string, commentId:string, content:string)=>void;
  onReactPost: (postId:string, type:'up'|'down')=>void;
  isAuthed: boolean;
  currentUserId: string;
  onEditPost: (postId:string, caption:string)=>void;
  onDeletePost: (postId:string)=>void;
}){
  if (!posts.length) return <p className="mt-16 text-center text-neutral-500">No posts yet.</p>;
  return (
    <div className="grid gap-6 mt-2">
      {posts.map(p=> (
        <PostCard key={p.id} post={p} getUser={getUser}
          isAuthed={isAuthed} currentUserId={currentUserId}
          onAddComment={onAddComment}
          onAddReply={onAddReply}
          onReactPost={onReactPost}
          onEditPost={onEditPost}
          onDeletePost={onDeletePost}
        />
      ))}
    </div>
  );
}

function PostReactionsOverlay({ upActive, downActive, onUp, onDown, disabled }:{ upActive:boolean, downActive:boolean, onUp:()=>void, onDown:()=>void, disabled:boolean }){
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2">
      <button disabled={disabled} onClick={onUp} title="Like"
        className={classNames('w-9 h-9 rounded-full shadow-md flex items-center justify-center bg-white transition', disabled? 'opacity-60':'hover:scale-105', upActive&&!disabled&&'ring-2 ring-green-500 text-green-600')}>
        <ThumbUpIcon/>
      </button>
      <button disabled={disabled} onClick={onDown} title="Dislike"
        className={classNames('w-9 h-9 rounded-full shadow-md flex items-center justify-center bg-white transition', disabled? 'opacity-60':'hover:scale-105', downActive&&!disabled&&'ring-2 ring-red-500 text-red-600')}>
        <ThumbDownIcon/>
      </button>
    </div>
  );
}

function ThumbUpIcon(){return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-3 8v10h9a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-3z"/></svg>);} 
function ThumbDownIcon(){return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l3-8V4H7a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h3z"/></svg>);} 

function CommentBlock({ c, user, postId, getUser, onAddReply, isAuthed }:{ c: Comment, user:{ id:string, username:string }, postId:string, getUser?:(id:string)=>Promise<Profile|null|undefined>, onAddReply?:(postId:string, commentId:string, content:string)=>void, isAuthed:boolean }){
  const [author,setAuthor] = useState<{id:string;username:string}>(user);
  useEffect(()=>{ let alive=true; if(getUser){ Promise.resolve(getUser(user.id)).then(p=>{ if(alive && p?.username){ setAuthor({ id:user.id, username:p.username }); } }); } return ()=>{ alive=false }; },[user.id, getUser]);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState('');
  const submitReply = ()=>{ if(!onAddReply || !isAuthed) return; if(!reply.trim()) return; onAddReply(postId, c.id, reply.trim()); setReply(''); setReplyOpen(false); };
  return (
    <div className="flex items-start gap-2 bg-neutral-100 rounded-xl p-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold">
        {author.username[0]?.toUpperCase()||'?'}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{author.username}</span>
          {c.edited && <span className="text-xs text-neutral-400">(edited)</span>}
          <span className="text-xs text-neutral-400 ml-auto">{new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <div className="text-sm mt-1 whitespace-pre-wrap break-words">{c.content}</div>
        <div className="mt-2 text-xs flex items-center gap-3">
          <button className="text-neutral-600 hover:underline disabled:opacity-50" disabled={!isAuthed} onClick={()=>setReplyOpen(v=>!v)}>Reply</button>
        </div>
        {replyOpen && (
          <div className="mt-2 flex items-center gap-2">
            <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{ if((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); submitReply(); } }} placeholder="Write a reply" className="flex-1 border border-neutral-300 rounded-xl px-3 py-2 text-sm"/>
            <button onClick={submitReply} disabled={!reply.trim()} className={classNames('px-2 py-1 rounded-lg text-xs', !reply.trim()? 'bg-neutral-200 text-neutral-500':'bg-neutral-900 text-white')}>Post</button>
          </div>
        )}
      </div>
        {(c.replies||[]).length>0 && (
          <div className="mt-2 pl-10 grid gap-2">
            {c.replies.map(rc => (
              <CommentBlock key={rc.id} c={rc} user={{ id: rc.userId, username: rc.userId }} postId={postId} getUser={getUser} onAddReply={onAddReply} isAuthed={isAuthed} />
            ))}
          </div>
        )}
    </div>
  );
}

function PostCard({ post, getUser, isAuthed, currentUserId, onAddComment, onReactPost, onEditPost, onDeletePost }:{
  post: Post;
  getUser: (id:string)=>any;
  isAuthed: boolean;
  currentUserId: string;
  onAddComment: (postId:string, content:string)=>void;
  onReactPost: (postId:string, type:'up'|'down')=>void;
  onEditPost: (postId:string, caption:string)=>void;
  onDeletePost: (postId:string)=>void;
}){
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(post.caption || '');
  const [comment, setComment] = useState('');
  const [author, setAuthor] = useState<any>(null);
  useEffect(()=>{ let alive=true; Promise.resolve(getUser(post.userId)).then(u=>{ if(alive) setAuthor(u||{ id:post.userId, username:post.userId }); }); return ()=>{ alive=false; }; },[post.userId, getUser]);

  const media_urls = post.media_urls;
  const mediaTypes = post.mediaTypes;
  const mediaCount = media_urls.length;
  const [slide, setSlide] = useState(0);
  const [mediaError, setMediaError] = useState(false);

  const comments = Array.isArray(post.comments) ? post.comments : [];
  const shown = expanded ? comments : comments.slice(-2);
  const hidden = Math.max(0, comments.length - shown.length);
  const isOwner = currentUserId === post.userId;

  const submitComment = () => { if (!isAuthed) return; if (comment.trim()) { onAddComment(post.id, comment); setComment(''); } };
  const saveCaption = () => { onEditPost(post.id, captionDraft); setEditing(false); };

  return (
    <article className="bg-white border border-neutral-200 rounded-3xl overflow-hidden shadow">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center font-semibold">{(author?.username?.[0]||'?').toUpperCase()}</div>
          <div className="leading-tight">
            <a href={`#/user/${author?.id||'unknown'}`} className="font-semibold hover:underline">{author?.username||'unknown'}</a>
            <div className="text-xs text-neutral-500">{timeAgo(post.createdAt)}</div>
          </div>
        </div>
        {(isOwner) && (
          <div className="flex items-center gap-2 text-xs">
            {!editing && <button className="px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>setEditing(true)}>Edit</button>}
            {editing && (<><button className="px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>{setEditing(false); setCaptionDraft(post.caption);}}>Cancel</button><button className="px-2 py-1 rounded-lg bg-neutral-900 text-white" onClick={saveCaption}>Save</button></>)}
            <button className="px-2 py-1 rounded-lg border border-red-300 text-red-600 hover:bg-red-50" onClick={()=>onDeletePost(post.id)}>Delete</button>
          </div>
        )}
      </div>

      <div className="relative w-full" style={{ paddingTop:'100%' }}>
          <div className="absolute inset-0 bg-black" tabIndex={0} onKeyDown={(e)=>{ if(e.key==="ArrowLeft"){ e.preventDefault(); setSlide((slide - 1 + mediaCount) % mediaCount); } if(e.key==="ArrowRight"){ e.preventDefault(); setSlide((slide + 1) % mediaCount); } }}>
          {!media_urls[slide] || mediaError ? (
            <div className="w-full h-full flex items-center justify-center bg-neutral-200 text-neutral-500">
              No media
            </div>
          ) : mediaTypes[slide]==='video' ? (
            <video src={media_urls[slide]} className="w-full h-full object-cover" controls playsInline onError={()=>setMediaError(true)} />
          ) : (
            <img src={media_urls[slide]} alt="Post media" className="w-full h-full object-cover" onError={()=>setMediaError(true)} />
          )}
          {mediaCount > 1 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-2 z-10">
              {media_urls.map((_, idx) => (
                <button key={idx} onClick={() => setSlide(idx)} className={classNames("w-2 h-2 rounded-full", slide === idx ? "bg-neutral-900" : "bg-neutral-300")} aria-label={`Go to slide ${idx + 1}`} />
              ))}
            </div>
          )}
          {mediaCount > 1 && (
            <>
              <button onClick={() => setSlide((slide - 1 + mediaCount) % mediaCount)} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 text-neutral-900 shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400" aria-label="Previous slide"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button onClick={() => setSlide((slide + 1) % mediaCount)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 text-neutral-900 shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-400" aria-label="Next slide"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
            </>
          )}
        </div>
        <PostReactionsOverlay
          upActive={!!currentUserId && (post.likesUp||[]).includes(currentUserId)}
          downActive={!!currentUserId && (post.likesDown||[]).includes(currentUserId)}
          onUp={()=>onReactPost(post.id,'up')}
          onDown={()=>onReactPost(post.id,'down')}
          disabled={!isAuthed}
        />
      </div>

      <div className="p-4">
        {!editing ? (
          <p className="text-sm whitespace-pre-wrap break-words">{post.caption} {post.edited && <span className="text-neutral-400">(edited)</span>}</p>
        ) : (
          <textarea className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm" value={captionDraft} onChange={e=>setCaptionDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); saveCaption(); } }} />
        )}
        {!isAuthed && <p className="text-xs text-neutral-500 mt-2">Log in to like or comment.</p>}

        {!!comments.length && (
          <div className="mt-3">
            {hidden>0 && !expanded && <button className="text-sm text-neutral-600 hover:underline" onClick={()=>setExpanded(true)}>Show more comments ({hidden})</button>}
            <div className="mt-2 grid gap-3">
              {shown.map(c=> (
                <CommentBlock key={c.id} c={c} user={{ id:c.userId, username:c.userId }} postId={post.id} getUser={getUser} onAddReply={onAddReply} isAuthed={isAuthed} />
              ))}
            </div>
            {expanded && hidden>0 && <button className="mt-2 text-sm text-neutral-600 hover:underline" onClick={()=>setExpanded(false)}>Show less</button>}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); submitComment(); } }} placeholder={isAuthed? 'Add a comment':'Log in to comment'} disabled={!isAuthed} className="flex-1 border border-neutral-300 rounded-xl px-3 py-2 text-sm disabled:bg-neutral-100"/>
          <button onClick={submitComment} disabled={!isAuthed||!comment.trim()} className={classNames('px-3 py-2 rounded-xl text-sm', (!isAuthed||!comment.trim())? 'bg-neutral-200 text-neutral-500':'bg-neutral-900 text-white')}>Post</button>
        </div>
      </div>
    </article>
  );
}

function RightRail(){
  const users = [ 'alice', 'bob', 'charlie', 'diana', 'eric' ];
  return (
    <div className="sticky top-20">
      <div className="bg-white border border-neutral-200 rounded-3xl p-3 shadow">
        <h3 className="font-semibold text-sm mb-2">Suggested for you</h3>
        <div className="grid gap-2">
          {users.map(u=> (
            <div key={u} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold">{u[0].toUpperCase()}</div>
                <div className="text-sm">{u}</div>
              </div>
              <button className="text-xs px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50">Follow</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedSkeleton(){
  return (
    <div className="grid gap-6">
      {[0,1,2].map(i=> (
        <div key={i} className="bg-white border border-neutral-200 rounded-3xl overflow-hidden shadow">
          <div className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-neutral-200" />
            <div className="h-3 w-24 bg-neutral-200 rounded" />
          </div>
          <div className="w-full" style={{paddingTop:'100%'}}>
            <div className="absolute inset-0 bg-neutral-200" />
          </div>
          <div className="p-4">
            <div className="h-3 w-3/4 bg-neutral-200 rounded mb-2" />
            <div className="h-3 w-2/4 bg-neutral-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileTabbar({ isAuthed }:{ isAuthed:boolean }){
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-neutral-200 bg-white/90 backdrop-blur md:hidden">
      <div className="max-w-2xl mx-auto px-6 py-2 flex items-center justify-between text-neutral-700">
        <a href="#/home" aria-label="Home" className="p-2"><HomeIcon/></a>
        <a href="#/new" aria-label="New" className={classNames('p-2 rounded-full', isAuthed? '':'opacity-50 pointer-events-none')}><AddIcon/></a>
        <button aria-label="Activity" className="p-2 opacity-60"><HeartIcon/></button>
        <a href="#/profile" aria-label="Profile" className="p-2 opacity-60"><UserIcon/></a>
      </div>
    </nav>
  );
}

function HomeIcon(){return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/></svg>);} 
function AddIcon(){return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>);} 
function HeartIcon(){return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>);} 
function UserIcon(){return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>);} 

function ProfileEditor({ loadProfile, onSave }:{ loadProfile: ()=>Promise<Profile|null>, onSave:(p:{username:string,bio?:string})=>void }){
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  useEffect(()=>{ (async()=>{ try { const p = await loadProfile(); if(p){ setUsername(p.username||''); setBio(p.bio||''); } } finally { setLoading(false);} })(); },[loadProfile]);
  if (loading) return <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow">Loading profileâ€¦</div>;
  const submit = ()=>{ setErr(''); if(!username.trim()) { setErr('Username is required'); return; } onSave({ username: username.trim(), bio: bio||'' }); };
  return (
    <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow">
      <h2 className="font-semibold mb-3">Edit profile</h2>
      <div className="grid gap-3">
        <label className="text-sm">Username
          <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)} placeholder="yourname" />
        </label>
        <label className="text-sm">Bio
          <textarea className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" rows={3} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell something about yourself" />
        </label>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex items-center gap-2 mt-1">
          <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Save</button>
          <a href="#/home" className="text-sm text-neutral-600 hover:underline">Cancel</a>
        </div>
      </div>
    </div>
  );
}

function Footer() { return <footer className="text-center text-xs text-neutral-400 py-6">InstaFacts</footer>; }

export default App;































