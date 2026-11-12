import {useEffect,useState} from 'react';
export function useScrollChrome(){
 const [state,setState]=useState({hidden:false,showTop:false});
 useEffect(()=>{let anchor=window.scrollY;let frame=0;
 const read=()=>{frame=0;const y=Math.max(0,window.scrollY);setState(old=>({showTop:y>window.innerHeight,hidden:y<100?false:Math.abs(y-anchor)>16?y>anchor:old.hidden}));if(Math.abs(y-anchor)>16)anchor=y;};
 const scroll=()=>{if(!frame)frame=requestAnimationFrame(read)};window.addEventListener('scroll',scroll,{passive:true});return()=>{window.removeEventListener('scroll',scroll);cancelAnimationFrame(frame)};
 },[]);return state;
}
