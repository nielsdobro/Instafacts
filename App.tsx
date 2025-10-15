import React, { useEffect, useRef, useState } from "react";

type Comment = {
  id: string;
  userId: string;
  content: string;
  createdAt: number;
  replies: Comment[];
  likesUp: string[];
  likesDown: string[];
  edited?: boolean;
};

type Post = {
  id: string;
  userId: string;
  caption: string;
  createdAt: number;
  media_urls: string[];
  mediaTypes: ("image"|"video")[];
  comments: Comment[];
  likesUp: string[];
  likesDown: string[];
  edited?: boolean;
};

const classNames = (...a: (string|false|undefined)[]) => a.filter(Boolean).join(" ");
const uid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const timeAgo = (ts:number) => {
  const s = Math.floor((Date.now()-ts)/1000);
  if (s<60) return `${s}s`; const m=Math.floor(s/60); if (m<60) return `${m}m`;
  const h=Math.floor(m/60); if (h<24) return `${h}h`; const d=Math.floor(h/24); if (d<7) return `${d}d`;
  return new Date(ts).toLocaleDateString();
};

function useToast(){
  const [toast, setToast] = useState<string|null>(null);
  const t = useRef<number|undefined>(undefined);
  const showToast = (msg:string, ms=2000)=>{
    setToast(msg);
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(()=>setToast(null), ms);
  };
  useEffect(()=>()=>{ if (t.current) window.clearTimeout(t.current); },[]);
  return { toast, showToast };
}

function Toast({ msg }:{ msg:string }){
  return <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-neutral-900 text-white px-4 py-2 rounded-xl shadow z-50">{msg}</div>;
}

function App(){
  const [route, setRoute] = useState<string>(()=>parseHash());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const { toast, showToast } = useToast();

  useEffect(()=>{
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  },[]);

  const isAuthed = !!currentUserId;

  const doSignIn = async ({ username }: { username:string }) => {
    setCurrentUserId(username || "user1");
    window.location.hash = '#/home';
  };
  const doSignUp = async ({ username }: { username:string }) => doSignIn({ username });
  const doSignOut = async () => { setCurrentUserId(null); window.location.hash = '#/home'; };

  const getUser = (id:string) => ({ id, username: id, bio: '' });

  const onAddComment = (postId:string, content:string) => {
    if (!isAuthed) return showToast('Please log in');
    setPosts(ps => ps.map(p => p.id===postId ? ({
      ...p,
      comments: [...p.comments, { id: uid('c'), userId: currentUserId!, content, createdAt: Date.now(), replies: [], likesUp: [], likesDown: [] }]
    }) : p));
  };

  const onReactPost = (postId:string, type:'up'|'down') => {
    if (!isAuthed) return showToast('Please log in');
    setPosts(ps => ps.map(p => {
      if (p.id!==postId) return p;
      const up = new Set(p.likesUp), down = new Set(p.likesDown);
      if (type==='up'){ up.has(currentUserId!)? up.delete(currentUserId!):(up.add(currentUserId!), down.delete(currentUserId!)); }
      else { down.has(currentUserId!)? down.delete(currentUserId!):(down.add(currentUserId!), up.delete(currentUserId!)); }
      return { ...p, likesUp:[...up], likesDown:[...down] };
    }));
  };

  const onEditPost = (postId:string, caption:string) => {
    setPosts(ps => ps.map(p => p.id===postId ? ({ ...p, caption, edited: true }) : p));
  };
  const onDeletePost = (postId:string) => setPosts(ps => ps.filter(p => p.id!==postId));

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <TopBar currentUserId={currentUserId} onSignOut={doSignOut} />
      <div className="max-w-2xl mx-auto px-4 pb-24">
        {toast && <Toast msg={toast} />}
        {route === 'login' && !isAuthed && (
          <LoginCard onSignIn={doSignIn} onSignUp={doSignUp} />
        )}
        {route === 'home' && (
          <HomeFeed
            posts={posts}
            getUser={getUser}
            onAddComment={onAddComment}
            onReactPost={onReactPost}
            isAuthed={isAuthed}
            currentUserId={currentUserId || ''}
            onEditPost={onEditPost}
            onDeletePost={onDeletePost}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}

function parseHash(){
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (!raw) return 'home';
  if ([ 'home','login' ].includes(raw)) return raw;
  return 'home';
}

function TopBar({ currentUserId, onSignOut }:{ currentUserId: string|null, onSignOut: ()=>void }){
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-neutral-200">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <a href="#/home" className="hover:opacity-90"><Logo size={26} /></a>
        <div className="flex items-center gap-2 text-sm">
          <a href="#/home" className="px-3 py-1.5 rounded-xl hover:bg-neutral-100">Home</a>
          {currentUserId ? (
            <button onClick={onSignOut} className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white hover:opacity-90">Log out</button>
          ) : (
            <a href="#/login" className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white">Log in</a>
          )}
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

function LoginCard({ onSignIn, onSignUp }:{ onSignIn:(p:{username:string,password?:string})=>void, onSignUp:(p:{username:string,password?:string})=>void }){
  const [mode,setMode]=useState<'signin'|'signup'>('signin');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const submit=()=>{ if(mode==='signin') onSignIn({ username, password }); else onSignUp({ username, password }); };
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
      <div className="grid gap-3">
        <label className="text-sm">Username
          <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. alice"/>
        </label>
        <label className="text-sm">Password
          <input className="mt-1 w-full border border-neutral-300 rounded-xl px-3 py-2" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        </label>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={submit} className="px-4 py-2 rounded-xl bg-neutral-900 text-white">{mode==='signin'? 'Log in':'Create account'}</button>
        </div>
      </div>
    </div>
  );
}

function HomeFeed({ posts, getUser, onAddComment, onReactPost, isAuthed, currentUserId, onEditPost, onDeletePost }:{
  posts: Post[];
  getUser: (id:string)=>{id:string, username:string, bio:string};
  onAddComment: (postId:string, content:string)=>void;
  onReactPost: (postId:string, type:'up'|'down')=>void;
  isAuthed: boolean;
  currentUserId: string;
  onEditPost: (postId:string, caption:string)=>void;
  onDeletePost: (postId:string)=>void;
}){
  if (!posts.length) return <p className="mt-10 text-center text-neutral-500">No posts yet. Log in to create one.</p>;
  return (
    <div className="grid gap-6 mt-2">
      {posts.map(p=> (
        <PostCard key={p.id} post={p} author={getUser(p.userId)}
          isAuthed={isAuthed} currentUserId={currentUserId}
          onAddComment={onAddComment}
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

function CommentBlock({ c, user }:{ c: Comment, user:{ id:string, username:string } }){
  return (
    <div className="flex items-start gap-2 bg-neutral-100 rounded-xl p-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center text-xs font-bold">
        {user.username[0]?.toUpperCase()||'?'}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{user.username}</span>
          {c.edited && <span className="text-xs text-neutral-400">(edited)</span>}
          <span className="text-xs text-neutral-400 ml-auto">{new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <div className="text-sm mt-1 whitespace-pre-wrap break-words">{c.content}</div>
      </div>
    </div>
  );
}

function PostCard({ post, author, isAuthed, currentUserId, onAddComment, onReactPost, onEditPost, onDeletePost }:{
  post: Post;
  author: { id:string, username:string };
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

  const media_urls = post.media_urls;
  const mediaTypes = post.mediaTypes;
  const mediaCount = media_urls.length;
  const [slide, setSlide] = useState(0);

  const comments = Array.isArray(post.comments) ? post.comments : [];
  const shown = expanded ? comments : comments.slice(-2);
  const hidden = Math.max(0, comments.length - shown.length);
  const isOwner = currentUserId === post.userId;

  const submitComment = () => {
    if (!isAuthed) return;
    if (comment.trim()) {
      onAddComment(post.id, comment);
      setComment('');
    }
  };

  const saveCaption = () => { onEditPost(post.id, captionDraft); setEditing(false); };

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
                <button key={idx} onClick={() => setSlide(idx)} className={classNames("w-2 h-2 rounded-full", slide === idx ? "bg-neutral-900" : "bg-neutral-300")} aria-label={`Go to slide ${idx + 1}`} />
              ))}
            </div>
          )}
          {mediaCount > 1 && (
            <>
              <button onClick={() => setSlide((slide - 1 + mediaCount) % mediaCount)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/70 rounded-full px-2 py-1" aria-label="Previous slide">‹</button>
              <button onClick={() => setSlide((slide + 1) % mediaCount)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/70 rounded-full px-2 py-1" aria-label="Next slide">›</button>
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
                <CommentBlock key={c.id} c={c} user={getUser(c.userId)} />
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

function Footer() { return <footer className="text-center text-xs text-neutral-400 py-6">InstaFacts</footer>; }

export default App;

