// Internal brand keys remain stable; public advertiser names can differ from them.
export function adLibraryUrl(source,{allowKeyword=true}={}){
  const pageId=String(source?.page_id||'');
  const verified=/^\d{5,30}$/.test(pageId);
  const searchName=String(source?.ad_library_search_name||source?.brand||'').trim();
  if(!verified&&(!allowKeyword||!searchName))return null;
  const query=new URLSearchParams({active_status:'active',ad_type:'all',country:'CY',media_type:'all'});
  if(verified){query.set('search_type','page');query.set('view_all_page_id',pageId)}
  else {query.set('search_type','keyword_unordered');query.set('q',searchName)}
  return 'https://www.facebook.com/ads/library/?'+query;
}
