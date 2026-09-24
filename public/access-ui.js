(()=>{
  let user=null;const listeners=new Set();
  document.documentElement.dataset.userRole='pending';
  const getUser=()=>user,isAdmin=()=>user?.role==='admin';
  const ready=(async()=>{
    try{
      const response=await fetch('/api/auth/me',{cache:'no-store'});
      if(response.ok){const data=await response.json();user=data.user||null}
    }catch{user=null}
    document.documentElement.dataset.userRole=isAdmin()?'admin':'standard';
    for(const listener of listeners){try{listener(user)}catch(error){console.error('Account view unavailable',error)}}
    return user;
  })();
  function subscribe(listener){listeners.add(listener);if(document.documentElement.dataset.userRole!=='pending')listener(user);return()=>listeners.delete(listener)}
  window.MarketPulseAccess={ready,getUser,isAdmin,subscribe};
})();
