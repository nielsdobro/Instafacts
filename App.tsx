import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// InstaFacts – Cloud-ready version (Supabase + Zapier) with local fallback
// ----------------------------------------------------------------------
// What’s new:
// - Data layer abstraction with **Supabase mode** (auth, storage, realtime) and
//   **Local mode** fallback (localStorage) so it runs in this canvas immediately.
// - Public read (no login), login/signup for posting/commenting.
// - New Post: vertical layout + square cropper (drag/zoom, press Enter to publish in caption).
// - Like/Dislike on posts/comments (green/red), overlay on media bottom-right.
// - Edit/Delete own posts & comments/replies. Edited shows “(edited)”.
// - Login/Signup: Enter submits.
// - Zapier-ready DB schema expectation (see README note at bottom of this file).
//
// To use Supabase in production:
//   1) Install: `npm i @supabase/supabase-js`
//   2) Add env vars (Vite-style): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
//   3) Deploy to Vercel/Netlify with these env vars set.
// The app will auto-detect Supabase; otherwise uses Local mode for this preview.

// ===== Utilities =====
const LS_KEYS = {
  users: "instafacts_users",
  currentUserId: "instafacts_current_user_id",
  posts: "instafacts_posts",
};

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveLS(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function loadLS(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`; const m = Math.floor(s/60); if (m < 60) return `${m}m`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h`; const d = Math.floor(h/24); if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}
const classNames = (...a) => a.filter(Boolean).join(" ");
function readFileAsDataURL(file){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(file);});}
async function dataURLToImage(dataURL){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src=dataURL;});}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ===== Minimal Data Layer Interface =====
// Methods: currentUser, signIn, signUp, signOut
//          listPosts, createPost, updatePost, deletePost
//          addComment, addReply, editComment, deleteComment
//          toggleReactPost, toggleReactComment
//          subscribe(cb) -> unsubscribe (Supabase only)



function demoSVG(text){return "data:image/svg+xml;utf8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#f58529'/><stop offset='50%' stop-color='#dd2a7b'/><stop offset='100%' stop-color='#8134af'/></linearGradient></defs><rect width='600' height='600' rx='40' fill='url(#g)'/><text x='50%' y='50%' text-anchor='middle' fill='white' font-size='48' font-family='Arial' dy='.3em'>${text}</text></svg>`);} 
function demoSquare(){return "data:image/svg+xml;utf8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='#222'/><circle cx='300' cy='300' r='200' fill='#999'/><text x='50%' y='50%' text-anchor='middle' fill='white' font-size='42' font-family='Arial' dy='.3em'>Square Media</text></svg>`);} 

function useDataLayer() {
  const [layer, setLayer] = useState<any>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        if (!url || !key) throw new Error("Missing Supabase env vars");
        const sb = createClient(url, key);
        const supa = await createSupabaseDataLayer(sb);
        setLayer(supa);
      } catch (e: any) {
        console.error("[InstaFacts] Supabase init failed:", e);
        setInitError("Supabase configuration error. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      }
    })();
  }, []);

  if (initError) {
    return null;
  }
  return layer;
}

async function createSupabaseDataLayer(supabase: any) {
  const [currentUser, setCurrentUser] = (() => {
    let user: any = null;
    let setUser: (u: any) => void = () => {};
    const listeners: ((u: any) => void)[] = [];
    setUser = (u) => {
      user = u;
      listeners.forEach((cb) => cb(u));
    };
    return [user, setUser];
  })();

  // Use React state for currentUser
  let userState: any = null;
  const getUser = async () => {
    const { data } = await supabase.auth.getUser();
    userState = data?.user || null;
    setCurrentUser(userState);
  };
  await getUser();
  supabase.auth.onAuthStateChange((_event: any, session: any) => {
    userState = session?.user || null;
    setCurrentUser(userState);
  });

  const mediaBucket = "media";

  return {
    mode: "supabase",
    get currentUser() { return userState; },
    async signUp({ username, password, bio }){
      const email = `${username.trim()}+instafacts@example.com`; // demo email format (no deliverability required)
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // store profile via a comment in bio? (optional separate table). For simplicity we keep username in user_metadata
      await supabase.auth.updateUser({ data: { username, bio } });
      return data.user;
    },
    async signIn({ username, password }){
      const email = `${username.trim()}+instafacts@example.com`;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user; return data.user;
    },
    async signOut(){ await supabase.auth.signOut(); currentUser=null; },
    async updateAccount({ username, bio }){
      const { error } = await supabase.auth.updateUser({ data: { username, bio } });
      if (error) throw error;
    },
    // Posts

async listPosts(){
  // 1) posts (newest first)
  const { data: postRows, error: postErr } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending:false })
    .limit(50);
  if (postErr) throw postErr;
  if (!postRows?.length) return [];

  const postIds = postRows.map(p => p.id);

  // 2) comments for these posts
  const { data: commentRows, error: cErr } = await supabase
    .from('comments')
    .select('*')
    .in('post_id', postIds)
    .order('created_at', { ascending:true });
  if (cErr) throw cErr;

  // 3) replies for these comments
  const commentIds = (commentRows || []).map(c => c.id);
  const { data: replyRows, error: rErr } = commentIds.length
    ? await supabase
        .from('replies')
        .select('*')
        .in('comment_id', commentIds)
        .order('created_at', { ascending:true })
    : { data: [], error: null };
  if (rErr) throw rErr;

  // 4) shape replies per comment
  const repliesByComment = new Map<string, any[]>();
  for (const r of replyRows || []) {
    const arr = repliesByComment.get(r.comment_id) || [];
    arr.push({
      id: r.id,
      userId: r.user_id,
      content: r.content,
      createdAt: new Date(r.created_at).getTime(),
      replies: [],
      likesUp: r.likes_up || [],
      likesDown: r.likes_down || [],
      edited: !!r.edited,
    });
    repliesByComment.set(r.comment_id, arr);
  }

  // 5) shape comments per post
  const commentsByPost = new Map<string, any[]>();
  for (const c of commentRows || []) {
    const arr = commentsByPost.get(c.post_id) || [];
    arr.push({
      id: c.id,
      userId: c.user_id,
      content: c.content,
      createdAt: new Date(c.created_at).getTime(),
      replies: repliesByComment.get(c.id) || [],
      likesUp: c.likes_up || [],
      likesDown: c.likes_down || [],
      edited: !!c.edited,
    });
    commentsByPost.set(c.post_id, arr);
  }

  // 6) final map to UI shape
  return postRows.map(row => ({
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type,
    media_url: row.media_url,
    caption: row.caption,
    createdAt: new Date(row.created_at).getTime(),
    comments: commentsByPost.get(row.id) || [],
    likesUp: row.likes_up || [],
    likesDown: row.likes_down || [],
    edited: !!row.edited,
  }));
},
    async createPost({ files, caption, croppedDataURLs }){
      if (!currentUser) throw new Error("Login required");
      let media_urls = [];
      let media_types = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let media_url = "";
        let media_type = file.type.startsWith("video") ? "video" : "image";
        if (file) {
          const ext = file.name.split('.').pop() || (media_type==='video'? 'mp4':'jpg');
          const path = `${currentUser.id}/${Date.now()}_${i}.${ext}`;
          const { error: upErr } = await supabase.storage.from(mediaBucket).upload(path, file, { upsert:false });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from(mediaBucket).getPublicUrl(path);
          media_url = pub.publicUrl;
        } else if (croppedDataURLs && croppedDataURLs[i]) {
          media_url = croppedDataURLs[i];
        }
        media_urls.push(media_url);
        media_types.push(media_type);
      }
      const { error } = await supabase.from('posts').insert({
        user_id: currentUser.id,
        media_types,
        media_urls,
        caption: caption.trim()
      });
      if (error) throw error;
    },
    async updatePost({ postId, caption }){
      if (!currentUser) return;
      const { error } = await supabase.from('posts').update({ caption: caption.trim(), edited: true }).eq('id', postId).eq('user_id', currentUser.id);
      if (error) throw error;
    },
    async deletePost({ postId }){
      if (!currentUser) return;
      const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
      if (error) throw error;
    },
    // Comments
    async addComment({ postId, content }){
      if (!currentUser) throw new Error("Login required");
      const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: currentUser.id, content: content.trim() });
      if (error) throw error;
    },
    async addReply({ postId, commentId, content }){
      if (!currentUser) throw new Error("Login required");
      const { error } = await supabase.from('replies').insert({ comment_id: commentId, user_id: currentUser.id, content: content.trim() });
      if (error) throw error;
    },
    async editComment({ postId, commentId, replyId, content }){
      if (!currentUser) return;
      if (!replyId){
        const { error } = await supabase.from('comments').update({ content: content.trim(), edited:true }).eq('id', commentId).eq('user_id', currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('replies').update({ content: content.trim(), edited:true }).eq('id', replyId).eq('user_id', currentUser.id);
        if (error) throw error;
      }
    },
    async deleteComment({ postId, commentId, replyId }){
      if (!currentUser) return;
      if (!replyId){
        const { error } = await supabase.from('comments').delete().eq('id', commentId).eq('user_id', currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('replies').delete().eq('id', replyId).eq('user_id', currentUser.id);
        if (error) throw error;
      }
    },
    async toggleReactPost({ postId, type }){
      if (!currentUser) return;
      // Use Postgres array toggling via RPC or simple fetch-read-update
      const { data: rows, error } = await supabase.from('posts').select('likes_up, likes_down').eq('id', postId).single();
      if (error) throw error;
      let up = new Set(rows.likes_up||[]); let down = new Set(rows.likes_down||[]);
      if (type==='up'){ up.has(currentUser.id)?up.delete(currentUser.id):(up.add(currentUser.id),down.delete(currentUser.id)); }
      else { down.has(currentUser.id)?down.delete(currentUser.id):(down.add(currentUser.id),up.delete(currentUser.id)); }
      const { error: upErr } = await supabase.from('posts').update({ likes_up:[...up], likes_down:[...down] }).eq('id', postId);
      if (upErr) throw upErr;
    },
    async toggleReactComment({ postId, commentId, replyId, type }){
      if (!currentUser) return;
      if (!replyId){
        const { data: row, error } = await supabase.from('comments').select('likes_up, likes_down').eq('id', commentId).single();
        if (error) throw error;
        let up=new Set(row.likes_up||[]), down=new Set(row.likes_down||[]);
        if (type==='up'){ up.has(currentUser.id)?up.delete(currentUser.id):(up.add(currentUser.id),down.delete(currentUser.id)); }
        else { down.has(currentUser.id)?down.delete(currentUser.id):(down.add(currentUser.id),up.delete(currentUser.id)); }
        const { error: e2 } = await supabase.from('comments').update({ likes_up:[...up], likes_down:[...down] }).eq('id', commentId);
        if (e2) throw e2;
      } else {
        const { data: row, error } = await supabase.from('replies').select('likes_up, likes_down').eq('id', replyId).single();
        if (error) throw error;
        let up=new Set(row.likes_up||[]), down=new Set(row.likes_down||[]);
        if (type==='up'){ up.has(currentUser.id)?up.delete(currentUser.id):(up.add(currentUser.id),down.delete(currentUser.id)); }
        else { down.has(currentUser.id)?down.delete(currentUser.id):(down.add(currentUser.id),up.delete(currentUser.id)); }
        const { error: e2 } = await supabase.from('replies').update({ likes_up:[...up], likes_down:[...down] }).eq('id', replyId);
        if (e2) throw e2;
      }
    },
    // Realtime across posts/comments/replies
    subscribe(onChange){
      const chan = supabase.channel('realtime:instafacts');
      chan.on('postgres_changes', { event:'*', schema:'public', table:'posts' }, onChange)
          .on('postgres_changes', { event:'*', schema:'public', table:'comments' }, onChange)
          .on('postgres_changes', { event:'*', schema:'public', table:'replies' }, onChange)
          .subscribe();
      return () => { supabase.removeChannel(chan); };
    },
    // No seed in cloud
    seed(){}
  };
}

// ===== App =====
function App(){
  const data = useDataLayer();
  const [routeState, setRoute] = useState(()=>parseHash());
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const { toast, showToast } = useToast();

  const refresh = async () => {
    if (!data) return;
    setLoadingPosts(true);
    try {
      const list = await data.listPosts();
      setPosts(list);
    } catch (e) {
      showToast("Failed to load posts.");
    }
    setLoadingPosts(false);
  };

  useEffect(()=>{ if (!data) return; if (data.mode==='local') data.seed(); refresh(); const unsub = data.subscribe? data.subscribe(()=>refresh()) : ()=>{}; return unsub; },[data]);
  const currentUser = data?.currentUser || null; const isAuthed = !!currentUser;

  // Top-level actions wire to data layer
  const doSignIn = async (p)=>{ try { await data.signIn(p); location.hash = '#/home'; setTimeout(refresh,10); } catch(e) { showToast(e.message || "Sign in failed."); } };
  const doSignUp = async (p)=>{ try { await data.signUp(p); location.hash = '#/home'; setTimeout(refresh,10); } catch(e) { showToast(e.message || "Sign up failed."); } };
  const doSignOut = async ()=>{
    try {
      await data.signOut();
      if (window.location.hash !== '#/home') {
        window.location.hash = '#/home';
      } else {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      setTimeout(refresh, 0);
    } catch(e) {
      showToast("Sign out failed.");
    }
  };
  const doUpdateAccount = async (p)=>{ await data.updateAccount(p); };
  const doCreate = async (p) => {
    try {
      await data.createPost(p);
      window.location.hash = '#/home';
      await refresh();
    } catch(e) {
      showToast("Failed to create post.");
    }
  };
  const doUpdatePost = async (id, caption)=>{ await data.updatePost({ postId:id, caption }); await refresh(); };
  const doDeletePost = async (id)=>{ try { await data.deletePost({ postId:id }); await refresh(); } catch(e) { showToast("Failed to delete post."); } };
  const doAddComment = async (postId, content) => {
    if (!data || !currentUser) return;
    setPosts(posts =>
      posts.map(post =>
        post.id === postId
          ? {
              ...post,
              comments: [
                ...post.comments,
                {
                  id: uid("c"),
                  userId: currentUser.id,
                  content,
                  createdAt: Date.now(),
                  replies: [],
                  likesUp: [],
                  likesDown: [],
                  edited: false,
                  optimistic: true,
                },
              ],
            }
            : post
      )
    );
    try {
      await data.addComment({ postId, content });
      await refresh();
    } catch (e) {
      showToast("Failed to add comment.");
    }
  };
  const doAddReply = async (postId, commentId, content)=>{ try { await data.addReply({ postId, commentId, content }); await refresh(); } catch(e) { showToast("Failed to add reply."); } };
  const doEditComment = async (postId, commentId, replyId, content)=>{ try { await data.editComment({ postId, commentId, replyId, content }); await refresh(); } catch(e) { showToast("Failed to edit comment."); } };
  const doDeleteComment = async (postId, commentId, replyId)=>{ try { await data.deleteComment({ postId, commentId, replyId }); await refresh(); } catch(e) { showToast("Failed to delete comment."); } };
  const doReactPost = async (postId, type)=>{ try { await data.toggleReactPost({ postId, type }); await refresh(); } catch(e) { showToast("Failed to react to post."); } };
  const doReactComment = async (postId, commentId, replyId, type)=>{ try { await data.toggleReactComment({ postId, commentId, replyId, type }); await refresh(); } catch(e) { showToast("Failed to react to comment."); } };

  const { route, params } = routeState;
  useEffect(()=>{ const gated=["new","profile","settings"]; const raw=window.location.hash.replace(/^#\/?/,""); if (!isAuthed && gated.includes(raw)) window.location.hash = "#/login"; },[isAuthed,route]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <TopBar currentUser={currentUser} onSignOut={doSignOut} />
      <div className="max-w-2xl mx-auto px-4 pb-24">
        {toast && <Toast msg={toast} />}
        {!data && <p className="mt-8 text-center text-neutral-500">Loading…</p>}
        {loadingPosts && <div className="mt-8 text-center"><Spinner /></div>}
        {data && route==='login' && !isAuthed && <LoginCard onSignIn={doSignIn} onSignUp={doSignUp} onSeed={()=>{ if(data.mode==='local') data.seed(); refresh(); }} />}
        {data && route==='home' && (
          <HomeFeed posts={posts}
            getUser={(id)=>resolveUsername(data, id)}
            onAddComment={doAddComment}
            onAddReply={doAddReply}
            onReactPost={doReactPost}
            onReactComment={doReactComment}
            isAuthed={isAuthed}
            currentUserId={currentUser?.id}
            onEditPost={doUpdatePost}
            onDeletePost={doDeletePost}
            onEditComment={doEditComment}
            onDeleteComment={doDeleteComment}
          />)}
        {data && route==='new' && <NewPost onCreate={doCreate} isAuthed={isAuthed} />}
        {data && route==='profile' && isAuthed && <Profile user={profileFromUser(currentUser)} posts={posts.filter(p=>p.userId===currentUser.id)} />}
        {data && route.startsWith('user:') && (
          <UserPublic
            user={mockUserFromId(params.userId)}
            posts={posts.filter(p=>p.userId===params.userId)}
            getUser={(id)=>resolveUsername(data, id)}
            onReactPost={doReactPost}
            onReactComment={doReactComment}
            isAuthed={isAuthed}
            onAddComment={doAddComment}
            onAddReply={doAddReply}
            currentUserId={currentUser?.id}
            onEditPost={doUpdatePost}
            onDeletePost={doDeletePost}
            onEditComment={doEditComment}
            onDeleteComment={doDeleteComment}
          />)}
        {data && route==='settings' && isAuthed && <AccountSettings user={profileFromUser(currentUser)} onSave={doUpdateAccount} />}
      </div>
      <Footer note={data? (data.mode==='supabase'? 'Cloud mode (Supabase)': 'Local mode (demo)'): ''} />
    </div>
  );
}

function parseHash(){ const raw=window.location.hash.replace(/^#\/?/,""); if(!raw) return {route:'home',params:{}}; if(raw.startsWith('user/')) return {route:`user:${raw.slice(5)}`,params:{userId:raw.slice(5)}}; if(['home','new','profile','login','settings'].includes(raw)) return {route:raw,params:{}}; return {route:'home',params:{}}; }

// Map DB row → UI post
function mapPostFromDB(row){
  return {
    id: row.id,
    userId: row.user_id,
    mediaTypes: row.media_types || [row.media_type],
    media_urls: row.media_urls || [row.media_url],
    caption: row.caption,
    createdAt: new Date(row.created_at).getTime(),
    comments: [],
    likesUp: row.likes_up || [],
    likesDown: row.likes_down || [],
    edited: !!row.edited,
  };
}
function profileFromUser(u){ return { id:u?.id, username:u?.user_metadata?.username || (u?.email?.split('+')[0]||'user'), bio:u?.user_metadata?.bio||'' }; }
function mockUserFromId(id){ return { id, username:`user_${String(id).slice(0,6)}`, bio:'' }; }
function resolveUsername(data, id){
  const cu = data?.currentUser; if (cu && cu.id===id) return profileFromUser(cu);
  // For demo, best-effort fallback name; in Supabase you would query a profiles table.
  return mockUserFromId(id);
}

// ===== UI =====
function TopBar({ currentUser, onSignOut }){
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-neutral-200">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <a href="#/home" className="hover:opacity-90"><Logo size={26} /></a>
        <div className="flex items-center gap-2 text-sm">
          <a href="#/home" className="px-3 py-1.5 rounded-xl hover:bg-neutral-100">Home</a>
          <a href="#/new" className="px-3 py-1.5 rounded-xl hover:bg-neutral-100">New Post</a>
          {currentUser && <a href="#/profile" className="px-3 py-1.5 rounded-xl hover:bg-neutral-100">Profile</a>}
          {currentUser ? (
            <>
              <a href="#/settings" aria-label="Account settings" className="p-1.5 rounded-xl hover:bg-neutral-100"><AccountIcon/></a>
              <button onClick={onSignOut} className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white hover:opacity-90">Log out</button>
            </>
          ) : (
            <a href="#/login" className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white">Log in</a>
          )}
        </div>
      </div>
    </header>
  );
}
function AccountIcon(){return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>);} 

// Minimalistic InstaFacts logo: Instagram-like gradient square with a white magnifying glass in the center
function Logo({ size = 28 }){
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="InstaFacts"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="igG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f58529" />
          <stop offset="50%" stopColor="#dd2a7b" />
          <stop offset="100%" stopColor="#8134af" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="22" fill="url(#igG)" />
      {/* Magnifying glass */}
      <circle cx="45" cy="45" r="18" fill="none" stroke="#fff" strokeWidth="8" />
      <line x1="58" y1="58" x2="75" y2="75" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
} 

function LoginCard({ onSignIn, onSignUp, onSeed }){
  const [mode,setMode]=useState('signin'); const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [bio,setBio]=useState(''); const [err,setErr]=useState('');
  const submit=async()=>{ setErr(''); try{ if(mode==='signin') await onSignIn({username,password}); else await onSignUp({username,password,bio}); }catch(e){ setErr(e.message||String(e)); } };
  const onKeyDown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } };
  return (
    <div className="mt-12 bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between mb-4">
        <Logo/>
        <div className="flex gap-2 text-sm">
          <button className={classNames('px-3 py-1.5 rounded-xl', mode==='signin'? 'bg-neutral-900 text-white':'bg-neutral-100')} onClick={()=>setMode('signin')}>Sign in</button>
          <button className={classNames('px-3 py-1.5 rounded-xl', mode==='signup'? 'bg-neutral-900 text-white':'bg-neutral-100')} onClick={()=>setMode('signup')}>Create account</button>
        </div>
      </div>
      <div className="grid gap-3">
        <label className="text-sm">Username
          <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. alice"/>
        </label>
        <label className="text-sm">Password
          <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        </label>
        {mode==='signup' && (
          <label className="text-sm">Short bio (optional)
            <textarea className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" rows={2} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell something about yourself"/>
          </label>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex items-center gap-2 mt-2">
          <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">{mode==='signin'? 'Log in':'Create account'}</button>
          <button onClick={onSeed} className="ml-auto px-3 py-2 rounded-xl border border-neutral-300 hover:bg-neutral-50 text-sm">Load demo data</button>
        </div>
      </div>
      <p className="mt-6 text-xs text-neutral-500">Data layer: auto-detects Supabase in production; local-only in this preview.</p>
    </div>
  );
}

function HomeFeed({ posts, getUser, onAddComment, onAddReply, onReactPost, onReactComment, isAuthed, currentUserId, onEditPost, onDeletePost, onEditComment, onDeleteComment }){
  if (!posts.length) return <p className="mt-10 text-center text-neutral-500">No posts yet. Log in to create one.</p>;
  return (
    <div className="grid gap-6 mt-2">
      {posts.map(p=> (
        <PostCard key={p.id} post={p} author={getUser(p.userId)} getUser={getUser}
          onAddComment={onAddComment} onAddReply={onAddReply}
          onReactPost={onReactPost} onReactComment={onReactComment}
          isAuthed={isAuthed} currentUserId={currentUserId}
          onEditPost={onEditPost} onDeletePost={onDeletePost}
          onEditComment={onEditComment} onDeleteComment={onDeleteComment}
        />
      ))}
    </div>
  );
}

function PostReactionsOverlay({ upActive, downActive, onUp, onDown, disabled }){
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

function InlineReactions({ upActive, downActive, upCount, downCount, onUp, onDown, disabled }){
  const base = "w-7 h-7 rounded-full border flex items-center justify-center text-xs transition";
  return (
    <div className="flex items-center gap-2 text-xs">
      <button disabled={disabled} onClick={onUp} className={classNames(base, 'border-neutral-300 bg-white', disabled? 'opacity-60':'hover:bg-neutral-50', upActive&&!disabled&&'border-green-500 text-green-600')} title="Like"><ThumbUpIcon/></button>
      <span className="text-neutral-500">{upCount}</span>
      <button disabled={disabled} onClick={onDown} className={classNames(base, 'border-neutral-300 bg-white', disabled? 'opacity-60':'hover:bg-neutral-50', downActive&&!disabled&&'border-red-500 text-red-600')} title="Dislike"><ThumbDownIcon/></button>
      <span className="text-neutral-500">{downCount}</span>
    </div>
  );
}
function ThumbUpIcon(){return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-3 8v10h9a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3h-3z"/></svg>);} 
function ThumbDownIcon(){return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l3-8V4H7a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h3z"/></svg>);} 

function PostCard({ post, author, getUser, ...props }){
  const [slide, setSlide] = useState(0);
  const mediaCount = post.media_urls?.length || 1;
  const mediaTypes = post.mediaTypes || ["image"];
  const media_urls = post.media_urls || [post.media_url];

  const comments = Array.isArray(post.comments)? post.comments: []; // In Supabase mode, comments are shown when added via realtime if you extend joins.
  const shown = expanded? comments : comments.slice(-2); const hidden=Math.max(0, comments.length - shown.length); const isOwner = currentUserId===post.userId;
  const submitComment=()=>{ if(!isAuthed) return; if(comment.trim()) { onAddComment(post.id, comment); setComment(''); } };
  const saveCaption=()=>{ onEditPost(post.id, captionDraft); setEditing(false); };
  return (
    <article className="bg-white border border-neutral-200 rounded-3xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center font-semibold">{(author?.username?.[0]||'?').toUpperCase()}</div>
          <div className="leading-tight">
            <a href={`#/user/${author?.id||'unknown'}`} className="font-semibold hover:underline">{author?.username||'unknown'}</a>
            <div className="text-xs text-neutral-500">{timeAgo(post.createdAt)}</div>
          </div>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2 text-xs">
            {!editing && <button className="px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>setEditing(true)}>Edit</button>}
            {editing && (<><button className="px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50" onClick={()=>{setEditing(false); setCaptionDraft(post.caption);}}>Cancel</button><button className="px-2 py-1 rounded-lg bg-neutral-900 text-white" onClick={saveCaption}>Save</button></>)}
            <button className="px-2 py-1 rounded-lg border border-red-300 text-red-600 hover:bg-red-50" onClick={()=>onDeletePost(post.id)}>Delete</button>
          </div>
        )}
      </div>

      <div className="relative w-full" style={{ paddingTop:'100%' }}>
        <div className="absolute inset-0 bg-black">
          {mediaTypes[slide]==='video' ? (
            <video src={media_urls[slide]} className="w-full h-full object-cover" controls playsInline />
          ) : (
            <img src={media_urls[slide]} alt="Post media" className="w-full h-full object-cover" />
          )}
          {mediaCount > 1 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-2 z-10">
              {media_urls.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setSlide(idx)}
                  className={classNames(
                    "w-2 h-2 rounded-full",
                    slide === idx ? "bg-neutral-900" : "bg-neutral-300"
                  )}
                  aria-label={`Go to slide ${idx + 1}`}
                  tabIndex={0}
                />
              ))}
            </div>
          )}
          {mediaCount > 1 && (
            <>
              <button
                onClick={() => setSlide((slide - 1 + mediaCount) % mediaCount)}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/70 rounded-full p-1"
                aria-label="Previous slide"
                tabIndex={0}
              >
                ‹
              </button>
              <button
                onClick={() => setSlide((slide + 1) % mediaCount)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/70 rounded-full p-1"
                aria-label="Next slide"
                tabIndex={0}
              >
                ›
              </button>
            </>
          )}
        </div>
        <PostReactionsOverlay
          upActive={!!props.currentUserId && (post.likesUp||[]).includes(props.currentUserId)}
          downActive={!!props.currentUserId && (post.likesDown||[]).includes(props.currentUserId)}
          onUp={()=>props.onReactPost(post.id,'up')}
          onDown={()=>props.onReactPost(post.id,'down')}
          disabled={!props.isAuthed}
        />
      </div>

      <div className="p-4">
        {!editing ? (
          <p className="text-sm whitespace-pre-wrap break-words">{post.caption} {post.edited && <span className="text-neutral-400">(edited)</span>}</p>
        ) : (
          <textarea className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm" value={captionDraft} onChange={e=>setCaptionDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); saveCaption(); } }} />
        )}
        {!isAuthed && <p className="text-xs text-neutral-500 mt-2">Log in to like or comment.</p>}

        {/* Local mode shows comments list; in Supabase mode, extend to fetch joins if desired */}
        {!!comments.length && (
          <div className="mt-3">
            {hidden>0 && !expanded && <button className="text-sm text-neutral-600 hover:underline" onClick={()=>setExpanded(true)}>Show more comments ({hidden})</button>}
            <div className="mt-2 grid gap-3">
              {shown.map(c=> (
                <CommentBlock key={c.id} postId={post.id} c={c} getUser={getUser} onReactComment={onReactComment} isAuthed={isAuthed} currentUserId={currentUserId} onAddReply={onAddReply} onEditComment={onEditComment} onDeleteComment={onDeleteComment}/>
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

function CommentBlock({ postId, c, getUser, onReactComment, isAuthed, currentUserId, onAddReply, onEditComment, onDeleteComment }){
  const [replying,setReplying]=useState(false); const [editing,setEditing]=useState(false); const [draft,setDraft]=useState(c.content); const isOwner=currentUserId===c.userId;
  const save=()=>{ onEditComment(postId, c.id, null, draft); setEditing(false); };
  return (
    <div>
      <div className="text-sm">
        <span className="font-semibold">{getUser(c.userId)?.username||'user'}</span> {editing? (<textarea className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm mt-2" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); save(); } }} />) : (<>{c.content} {c.edited && <span className="text-neutral-400">(edited)</span>}</>)}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>{timeAgo(c.createdAt)}</span>
        {isAuthed && !editing && <button className="hover:underline" onClick={()=>setReplying(true)}>Reply</button>}
        <InlineReactions upActive={!!currentUserId && (c.likesUp||[]).includes(currentUserId)} downActive={!!currentUserId && (c.likesDown||[]).includes(currentUserId)} upCount={(c.likesUp||[]).length} downCount={(c.likesDown||[]).length} onUp={()=>onReactComment(postId,c.id,null,'up')} onDown={()=>onReactComment(postId,c.id,null,'down')} disabled={!isAuthed}/>
        {isOwner && !editing && (<><button className="hover:underline" onClick={()=>setEditing(true)}>Edit</button><button className="hover:underline text-red-600" onClick={()=>onDeleteComment(postId, c.id, null)}>Delete</button></>)}
        {editing && (<><button className="hover:underline" onClick={()=>setEditing(false)}>Cancel</button><button className="hover:underline text-green-600" onClick={save}>Save</button></>)}
      </div>
      {!!(c.replies||[]).length && (
        <div className="mt-2 ml-3 border-l border-neutral-200 pl-3 grid gap-2">
          {(c.replies||[]).map(r=> (<ReplyBlock key={r.id} postId={postId} commentId={c.id} r={r} getUser={getUser} onReactComment={onReactComment} isAuthed={isAuthed} currentUserId={currentUserId} onEditComment={onEditComment} onDeleteComment={onDeleteComment}/>))}
        </div>
      )}
      {replying && isAuthed && <InlineReply onCancel={()=>setReplying(false)} onSubmit={(text)=>{ onAddReply(postId, c.id, text); setReplying(false); }}/>}    
    </div>
  );
}

function ReplyBlock({ postId, commentId, r, getUser, onReactComment, isAuthed, currentUserId, onEditComment, onDeleteComment }){
  const [editing,setEditing]=useState(false); const [draft,setDraft]=useState(r.content); const isOwner=currentUserId===r.userId; const save=()=>{ onEditComment(postId, commentId, r.id, draft); setEditing(false); };
  return (
    <div className="text-sm">
      <span className="font-semibold">{getUser(r.userId)?.username||'user'}</span> {editing? (<textarea className="w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm mt-2" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); save(); } }} />) : (<>{r.content} {r.edited && <span className="text-neutral-400">(edited)</span>}</>)}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>{timeAgo(r.createdAt)}</span>
        <InlineReactions upActive={!!currentUserId && (r.likesUp||[]).includes(currentUserId)} downActive={!!currentUserId && (r.likesDown||[]).includes(currentUserId)} upCount={(r.likesUp||[]).length} downCount={(r.likesDown||[]).length} onUp={()=>onReactComment(postId,commentId,r.id,'up')} onDown={()=>onReactComment(postId,commentId,r.id,'down')} disabled={!isAuthed}/>
        {isOwner && !editing && (<><button className="hover:underline" onClick={()=>setEditing(true)}>Edit</button><button className="hover:underline text-red-600" onClick={()=>onDeleteComment(postId, commentId, r.id)}>Delete</button></>)}
        {editing && (<><button className="hover:underline" onClick={()=>setEditing(false)}>Cancel</button><button className="hover:underline text-green-600" onClick={save}>Save</button></>)}
      </div>
    </div>
  );
}

function InlineReply({ onCancel, onSubmit }){
  const [v,setV]=useState(''); const onSend=()=>{ if(v.trim()) onSubmit(v); };
  return (
    <div className="mt-2 flex gap-2">
      <input value={v} onChange={e=>setV(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); onSend(); } }} placeholder="Write a reply" className="flex-1 border border-neutral-300 rounded-xl px-3 py-2 text-sm"/>
      <button onClick={onCancel} className="px-3 py-2 rounded-xl border border-neutral-300 text-sm">Cancel</button>
      <button onClick={onSend} className="px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm">Reply</button>
    </div>
  );
}

// ===== New Post with square cropper (vertical layout) =====
function NewPost({ onCreate, isAuthed }) {
  const [files, setFiles] = useState([]);
  const [rawDataURLs, setRawDataURLs] = useState([]);
  const [caption, setCaption] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  const pickFiles = async fs => {
    if (!fs || !fs.length) return;
    const arr = Array.from(fs);
    setFiles(arr);
    const urls = await Promise.all(arr.map(f => readFileAsDataURL(f)));
    setRawDataURLs(urls);
  };

  const publish = async () => {
    setErr('');
    if (!isAuthed) { setErr('Log in to post'); return; }
    if (!files.length) { setErr('Please select at least one image or video'); return; }
    if (!caption.trim()) { setErr('Caption is required'); return; }
    await onCreate({ files, caption, croppedDataURLs: rawDataURLs });
  };

  const resetAll = () => {
    setFiles([]);
    setRawDataURLs([]);
    setCaption('');
    setErr('');
  };

  return (
    <div className="mt-4 bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
      <h2 className="text-lg font-semibold mb-4">Create a new post</h2>
      {!isAuthed && <p className="text-sm text-red-600 mb-3">You must log in to publish.</p>}
      <div className="grid gap-4">
        <div className="relative">
          <div className="relative w-full rounded-2xl overflow-hidden border border-dashed border-neutral-300 bg-neutral-50" style={{ paddingTop: '100%' }}>
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
              {files.length === 0 ? (
                <div className="grid gap-2">
                  <button onClick={() => inputRef.current?.click()} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Select images or videos</button>
                  <p className="text-xs text-neutral-500">or drag & drop here</p>
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto">
                  {files.map((file, idx) => (
                    <div key={idx} className="w-24 h-24 border rounded overflow-hidden flex-shrink-0 relative">
                      {file.type.startsWith('video') ? (
                        <video src={rawDataURLs[idx]} className="w-full h-full object-cover" controls />
                      ) : (
                        <img src={rawDataURLs[idx]} alt="preview" className="w-full h-full object-cover" />
                      )}
                      <button
                        className="absolute top-1 right-1 bg-white rounded-full px-2 py-0 text-xs"
                        onClick={() => {
                          setFiles(files.filter((_, i) => i !== idx));
                          setRawDataURLs(rawDataURLs.filter((_, i) => i !== idx));
                        }}
                        title="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={e => pickFiles(e.target.files)}
              />
            </div>
          </div>
        </div>
        <label className="text-sm">Caption
          <textarea className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" rows={4} value={caption} onChange={e => setCaption(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); publish(); } }} placeholder="Write a description" />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={publish} className="px-4 py-2 rounded-xl bg-neutral-900 text-white" disabled={!isAuthed}>Publish</button>
          <button onClick={resetAll} className="px-4 py-2 rounded-xl border border-neutral-300">Reset</button>
        </div>
      </div>
    </div>
  );
}

function Profile({ user, posts }){
  return (
    <div className="mt-4">
      <div className="bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center text-xl font-semibold">{user.username[0].toUpperCase()}</div>
          <div>
            <h2 className="text-lg font-semibold">{user.username}</h2>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap mt-1">{user.bio||''}</p>
          </div>
        </div>
      </div>
      <h3 className="mt-6 mb-3 font-semibold">Your posts</h3>
      {!posts.length? <p className="text-neutral-500">No posts yet.</p> : (
        <div className="grid gap-6">
          {posts.map(p=> (
            <PostCard key={p.id} post={p} author={user} getUser={(id)=>user}
              onAddComment={()=>{}} onAddReply={()=>{}} onReactPost={()=>{}} onReactComment={()=>{}}
              isAuthed={true} currentUserId={user.id}
              onEditPost={()=>{}} onDeletePost={()=>{}} onEditComment={()=>{}} onDeleteComment={()=>{}} />
          ))}
        </div>
      )}
    </div>
  );
}

function UserPublic({ user, posts, getUser, onReactPost, onReactComment, isAuthed, onAddComment, onAddReply, currentUserId, onEditPost, onDeletePost, onEditComment, onDeleteComment }){
  if(!user) return <p className="mt-6 text-neutral-500">User not found.</p>;
  return (
    <div className="mt-4">
      <div className="bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center text-xl font-semibold">{user.username[0].toUpperCase()}</div>
          <div>
            <h2 className="text-lg font-semibold">{user.username}</h2>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap">{user.bio||''}</p>
          </div>
        </div>
      </div>
      <h3 className="mt-6 mb-3 font-semibold">Posts</h3>
      {!posts.length? <p className="text-neutral-500">No posts yet.</p> : (
        <div className="grid gap-6">
          {posts.map(p=> (
            <PostCard key={p.id} post={p} author={user} getUser={getUser}
              onAddComment={onAddComment} onAddReply={onAddReply}
              onReactPost={onReactPost} onReactComment={onReactComment}
              isAuthed={isAuthed} currentUserId={currentUserId}
              onEditPost={onEditPost} onDeletePost={onDeletePost}
              onEditComment={onEditComment} onDeleteComment={onDeleteComment} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountSettings({ user, onSave }){
  const [editing,setEditing]=useState(false); const [username,setUsername]=useState(user.username); const [bio,setBio]=useState(user.bio||''); const [err,setErr]=useState('');
  const submit=async()=>{ try{ await onSave({ username, bio }); setEditing(false); setErr(''); } catch(e){ setErr(String(e.message||e)); } };
  return (
    <div className="mt-4 bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Account</h2>
      {!editing ? (
        <div className="grid gap-3">
          <div><span className="text-sm text-neutral-500">Username</span><div className="font-medium">{user.username}</div></div>
          <div><span className="text-sm text-neutral-500">Bio</span><div className="whitespace-pre-wrap">{user.bio||''}</div></div>
          <div><button onClick={()=>setEditing(true)} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Edit</button></div>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="text-sm">Username
            <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)}/>
          </label>
          <label className="text-sm">Bio
            <textarea className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" rows={4} value={bio} onChange={e=>setBio(e.target.value)}/>
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">Save</button>
            <button onClick={()=>{ setEditing(false); setUsername(user.username); setBio(user.bio||''); setErr(''); }} className="px-4 py-2 rounded-xl border border-neutral-300">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Footer({ note }){
  return (
    <footer className="mt-14 border-t border-neutral-200 py-8 text-center text-xs text-neutral-500">
      <p>InstaFacts mock for a Generative AI course. {note}</p>
      <p className="mt-2">Zapier: Use Supabase app to insert into <code>posts</code>/<code>comments</code>. For a bot account, map a fixed <code>user_id</code>.</p>
    </footer>
  );
}

// Spinner component
function Spinner() {
  return (
    <div className="flex justify-center items-center">
      <svg className="animate-spin h-8 w-8 text-neutral-400" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 0 8-8v8z"/>
      </svg>
    </div>
  );
}

// Toast system
function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };
  return { toast, showToast };
}

// Toast component
function Toast({ msg }) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-4 py-2 rounded-xl shadow-lg z-50 text-sm">
      {msg}
    </div>
  );
}
