"use client";
import React,{useState} from 'react';

/** Small dish pictures only; original captures never enter browser persistence. */
export default function RecipeImage({recipe,detail=false,fallback}:{recipe:Record<string,any>;detail?:boolean;fallback?:React.ReactNode}){
 const [failed,setFailed]=useState(false);
 const src=recipe.photo?.url||recipe.photoSourceUrl;
 if(!src||failed)return <>{fallback}</>;
 return <img className={detail?'recipe-dish-photo detail':'recipe-dish-photo'} src={src} alt={recipe.title||'Recipe dish'} width={480} height={320} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
