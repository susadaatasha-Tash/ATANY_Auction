import { useCallback,useEffect,useRef,useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { supabase } from '../../../shared/lib/supabaseClient';
export function useOrderData(id) {
  const [state,setState]=useState({id:null,data:null,loading:true,error:null});
  const serial=useRef(0);
  const refresh=useCallback(async(silent=false)=>{
    const request=++serial.current;
    if(!silent)setState({id,data:null,loading:true,error:null});
    try {const data=await apiFetch(`/customer/orders/${id}`);if(serial.current===request)setState({id,data,loading:false,error:null});return data;}
    catch(e){if(serial.current===request)setState(s=>({...s,id,loading:false,error:e.message || 'Unable to load order.'}));return null;}
  },[id]);
  useEffect(()=>{refresh();return()=>{serial.current++;};},[refresh]);
  useEffect(()=>{
    const revalidate=()=>refresh(true);
    window.addEventListener('focus',revalidate);window.addEventListener('pageshow',revalidate);
    return()=>{window.removeEventListener('focus',revalidate);window.removeEventListener('pageshow',revalidate);};
  },[refresh]);
  useEffect(()=>{
    const channel=supabase.channel(`order-details-${id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`id=eq.${id}`},()=>refresh(true))
      .on('postgres_changes',{event:'*',schema:'public',table:'payments',filter:`order_id=eq.${id}`},()=>refresh(true)).subscribe();
    return ()=>{supabase.removeChannel(channel);};
  },[id,refresh]);
  return {...(state.id===id?state:{data:null,loading:true,error:null}),refresh};
}
