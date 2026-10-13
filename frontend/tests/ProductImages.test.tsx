// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductImages } from '../src/catalog/ProductImages';
import { ApiError } from '../src/lib/api';
import type { SessionClient } from '../src/lib/session';
import { deferred, restoredStaff } from './fakeApi';
import { createSessionSource, renderWithSession, requiredElement, setInputValue, settle, unmountAll } from './renderWithSession';
vi.mock('next/navigation',()=>({usePathname:()=>'/staff/products'}));
vi.mock('next/image',()=>({default:(props:React.ImgHTMLAttributes<HTMLImageElement>)=>createElement('img',props)}));
const id='8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b';
const image={id,url:`/api/public/product-images/${id}.png`,contentType:'image/png',width:800,height:600,byteSize:10,altText:null,position:0,version:0,createdAt:'2026-10-08T09:30:00Z'};
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','');this.querySelector('input')?.focus();}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.removeAttribute('open');}});
});
afterEach(unmountAll);
function source(answer:(path:string,init:RequestInit)=>Response|Promise<Response>){
 const calls:{path:string;init:RequestInit}[]=[];
 const authenticatedFetch:SessionClient['authenticatedFetch']=async(path,init,read)=>{calls.push({path,init});return read(await answer(path,init));};
 return {calls,session:createSessionSource({restoreSession:async()=>restoredStaff('VERIFIED'),authenticatedFetch})};
}
function button(view:ParentNode,text:string){const found=[...view.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);if(!found)throw Error(`Missing ${text}`);return found;}
async function click(view:ParentNode,text:string){await act(async()=>button(view,text).click());await settle();}
async function choose(view:ParentNode,file=new File(['png'],'x.png',{type:'image/png'})){
 const input=requiredElement<HTMLInputElement>(view,'input[type="file"]');Object.defineProperty(input,'files',{configurable:true,value:[file]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));await settle();
}
describe('Product Images card',()=>{
 it('retries a failed list and replaces the upload slot at eight images',async()=>{
  let lists=0;const all=Array.from({length:8},(_,position)=>({...image,id:`${position}a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b`,url:`/api/public/product-images/${position}a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b.png`,position}));
  const {session}=source(()=>++lists===1?Response.json({code:'STORAGE_UNAVAILABLE'},{status:503}):Response.json({images:all,maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  expect(requiredElement(view,'[role="alert"]').textContent).toContain('Images could not be loaded.');await click(view,'Try again');
  expect(view.querySelectorAll('button.thumb')).toHaveLength(8);expect(view.textContent).toContain('maximum of 8 images');expect([...view.querySelectorAll('button')].some(b=>b.textContent==='Upload image')).toBe(false);
 });
 it('shows loading without a live-region announcement until the list arrives',async()=>{
  const held=deferred<Response>();const {session}=source(()=>held.promise);
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  expect(view.textContent).toContain('Loading images…');expect(view.querySelector('[role="status"], [role="alert"]')).toBeNull();
  await act(async()=>held.resolve(Response.json({images:[],maxImages:8})));await settle();expect(button(view,'Upload image')).toBeTruthy();
 });
 it('retries only the list after an upload commits and its refresh fails',async()=>{
  let lists=0;const {calls,session}=source((_path,init)=>{
   if(init.method==='POST')return Response.json(image,{status:201});
   if(++lists===2)throw new ApiError('REQUEST_FAILED',0);
   return Response.json({images:lists>2?[image]:[],maxImages:8});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await choose(view);
  expect(requiredElement(view,'[role="alert"]').textContent).toContain('Images could not be loaded.');
  expect(view.querySelector('[role="status"]')).toBeNull();
  expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(1);
  await click(view,'Try again');
  expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(1);
  expect(calls.filter(c=>c.init.method==='GET')).toHaveLength(3);
  expect(view.querySelector('[role="alert"]')).toBeNull();
  expect(view.querySelectorAll('button.thumb')).toHaveLength(1);
  expect(requiredElement<HTMLImageElement>(view,'button.thumb img').src).toContain(image.url);
  expect(button(view,'Upload image').disabled).toBe(false);
 });
 it('discards a retry when a fresh file is chosen and uses a fresh upload identity',async()=>{
  let uploads=0;const {calls,session}=source((_path,init)=>{
   if(init.method==='GET')return Response.json({images:[],maxImages:8});
   if(++uploads===1)throw new ApiError('REQUEST_FAILED',0);return Response.json(image,{status:201});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  const file=new File(['png'],'same.png',{type:'image/png'});await choose(view,file);expect(button(view,'Try again')).toBeTruthy();await choose(view,file);
  const bodies=calls.filter(c=>c.init.method==='POST').map(c=>c.init.body as FormData);
  expect(bodies[0].get('id')).not.toBe(bodies[1].get('id'));expect(bodies[0].get('file')).toBe(bodies[1].get('file'));
  expect(requiredElement<HTMLInputElement>(view,'input[type="file"]').value).toBe('');expect(view.textContent).not.toContain('Try again');
 });
 it('reloads a concurrent image limit refusal and discards replay',async()=>{
  let lists=0;const {calls,session}=source((_path,init)=>init.method==='GET'?(lists++,Response.json({images:[],maxImages:8})):Response.json({code:'IMAGE_LIMIT_REACHED'},{status:409}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);await choose(view);
  expect(lists).toBe(2);expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(1);expect(view.textContent).toContain('maximum number of images');expect(view.textContent).not.toContain('Try again');
 });
 it('keeps invalid and conflicting upload refusals bounded without offering replay',async()=>{
  let uploads=0;const {calls,session}=source((_path,init)=>init.method==='GET'?Response.json({images:[],maxImages:8}):Response.json({code:++uploads===1?'IMAGE_INVALID':'ID_CONFLICT'},{status:uploads===1?400:409}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);await choose(view);
  expect(view.textContent).toContain('The file is not a valid JPG or PNG image within the size limits.');expect(view.textContent).not.toContain('Try again');await choose(view);
  const bodies=calls.filter(c=>c.init.method==='POST').map(c=>c.init.body as FormData);expect(bodies[0].get('id')).not.toBe(bodies[1].get('id'));expect(view.textContent).not.toContain('Try again');
 });
 it('confirms removal, closes before sending and focuses the next surviving identity',async()=>{
  const second={...image,id:'9a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b',url:'/api/public/product-images/9a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b.png',position:1};let removed=false;
  const {calls,session}=source((_path,init)=>{
   if(init.method==='DELETE'){expect(document.querySelector('dialog[open]')).toBeNull();removed=true;return new Response(null,{status:204});}
   return Response.json({images:removed?[{...second,position:0}]:[image,second],maxImages:8});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());await click(view,'Remove image');await click(view,'Cancel');expect(calls.some(c=>c.init.method==='DELETE')).toBe(false);
  await click(view,'Remove image');await click(view,'Remove');expect(view.textContent).toContain('Image removed.');expect(document.activeElement).toBe(requiredElement(view,'button.thumb'));
 });
 it('returns focus to upload after removing the last image and announces an already removed image',async()=>{
  let removed=false;const {session}=source((_path,init)=>{
   if(init.method==='DELETE'){removed=true;return Response.json({code:'NOT_FOUND'},{status:404});}
   return Response.json({images:removed?[]:[image],maxImages:8});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());await click(view,'Remove image');await click(view,'Remove');
  expect(view.textContent).toContain('This image was already removed.');expect(document.activeElement).toBe(requiredElement(view,'[role="status"]'));expect(button(view,'Upload image')).toBeTruthy();
 });
 it('preserves accepted Unicode boundaries when rendering and saving a description',async()=>{
  const altText='\u00a0Front\ufeff';
  const {calls,session}=source((_path,init)=>init.method==='PUT'?Response.json({...image,altText,version:1}):Response.json({images:[{...image,altText}],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  expect(requiredElement<HTMLImageElement>(view,'button.thumb img').alt).toBe(altText);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());await click(view,'Save description');
  expect(JSON.parse(String(calls.find(c=>c.init.method==='PUT')?.init.body))).toEqual({altText,version:0});
  expect(requiredElement<HTMLImageElement>(view,'button.thumb img').alt).toBe(altText);
 });
 it('saves a trimmed description, closes the dialog and returns focus to its thumbnail',async()=>{
  const {calls,session}=source((_path,init)=>init.method==='PUT'?Response.json({...image,altText:'Front',version:1}):Response.json({images:[image],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());setInputValue(view,'#image-alt','  Front  ');await click(view,'Save description');
  expect(JSON.parse(String(calls.find(c=>c.init.method==='PUT')?.init.body))).toEqual({altText:'Front',version:0});expect(requiredElement<HTMLDialogElement>(view,'dialog').open).toBe(false);
  expect(document.activeElement).toBe(requiredElement(view,'button.thumb'));expect(requiredElement(view,'button.thumb').getAttribute('aria-label')).toBe('Image 1: Front');
 });
 it('renders only the upload slot when idle and empty',async()=>{
  const {session}=source(()=>Response.json({images:[],maxImages:8}));const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  expect(view.querySelectorAll('button')).toHaveLength(1);expect(view.textContent).toContain('The first image is the main image.');expect(view.querySelector('[role="status"], [role="alert"]')).toBeNull();
 });
 it('prechecks an oversized file without uploading and focuses the explanation',async()=>{
  const {calls,session}=source(()=>Response.json({images:[],maxImages:8}));const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await choose(view,new File([new Uint8Array(3145729)],'x.png',{type:'image/png'}));
  expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(0);expect(requiredElement(view,'[role="status"]').textContent).toContain('3 MB');expect(document.activeElement).toBe(requiredElement(view,'[role="status"]'));
 });
 it('focuses repeated identical file precheck refusals without sending a request',async()=>{
  const {calls,session}=source(()=>Response.json({images:[],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  for(const name of ['first.webp','second.webp']){
   await act(async()=>button(view,'Upload image').focus());
   await choose(view,new File(['invalid'],name,{type:'image/webp'}));
   expect(document.activeElement).toBe(requiredElement(view,'[role="status"]'));
  }
  expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(0);
 });
 it.each([0,503])('keeps exactly the failed upload identity and body for retry status %s',async(status)=>{
  let uploads=0;const {calls,session}=source((_path,init)=>{
   if(init.method==='GET')return Response.json({images:uploads>1?[image]:[],maxImages:8});
   if(++uploads===1){if(!status)throw new ApiError('REQUEST_FAILED',0);return Response.json({code:'STORAGE_UNAVAILABLE'},{status});}
   return Response.json(image,{status:201});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await choose(view);await click(view,'Try again');const bodies=calls.filter(c=>c.init.method==='POST').map(c=>c.init.body as FormData);
  expect(bodies).toHaveLength(2);expect(bodies[0].get('id')).toBe(bodies[1].get('id'));expect(bodies[0].get('file')).toBe(bodies[1].get('file'));
  expect(view.textContent).toContain('Image uploaded.');expect(view.textContent).not.toContain('Try again');
 });
 it('closes replacement dialog before sending and retains original alt and replaces through retry',async()=>{
  let posts=0;const {calls,session}=source((_path,init)=>{
   if(init.method==='GET')return Response.json({images:[{...image,altText:'Front'}],maxImages:8});
   expect(document.querySelector('dialog[open]')).toBeNull();if(++posts===1)throw new ApiError('REQUEST_FAILED',0);return Response.json(image,{status:201});
  });
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());await click(view,'Replace image');await choose(view);await click(view,'Try again');
  const bodies=calls.filter(c=>c.init.method==='POST').map(c=>c.init.body as FormData);
  expect(bodies[0].get('id')).toBe(bodies[1].get('id'));expect(bodies[1].get('replaces')).toBe(id);expect(bodies[1].get('altText')).toBe('Front');
 });
 it('guards a double file event while upload is pending',async()=>{
  const held=deferred<Response>();const {calls,session}=source((_path,init)=>init.method==='POST'?held.promise:Response.json({images:[],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await choose(view);await choose(view);expect(calls.filter(c=>c.init.method==='POST')).toHaveLength(1);expect(button(view,'Upload image').disabled).toBe(true);
  await act(async()=>held.resolve(Response.json(image,{status:201})));await settle();expect(button(view,'Upload image').disabled).toBe(false);
 });
 it('keeps typed description inside an open dialog after transport refusal',async()=>{
  const {session}=source((_path,init)=>{if(init.method==='PUT')throw new ApiError('REQUEST_FAILED',0);return Response.json({images:[image],maxImages:8});});
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>requiredElement<HTMLButtonElement>(view,'button.thumb').click());setInputValue(view,'#image-alt','Typed description');await click(view,'Save description');
  expect(requiredElement<HTMLDialogElement>(view,'dialog').open).toBe(true);expect(requiredElement<HTMLInputElement>(view,'#image-alt').value).toBe('Typed description');expect(document.activeElement).toBe(requiredElement(view,'dialog [role="alert"]'));
 });
 it('reloads a stale reorder using the full displayed expected order',async()=>{
  const second={...image,id:'9a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b',url:'/api/public/product-images/9a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b.png',position:1};
  const {calls,session}=source((_path,init)=>init.method==='PUT'?Response.json({code:'STALE_UPDATE'},{status:409}):Response.json({images:[image,second],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);
  await act(async()=>view.querySelectorAll<HTMLButtonElement>('button.thumb')[1].click());await click(view,'Make main image');
  const command=calls.find(c=>c.init.method==='PUT');expect(JSON.parse(String(command?.init.body))).toEqual({imageIds:[second.id,id],expectedImageIds:[id,second.id]});
  expect(requiredElement(view,'[role="status"]').textContent).toContain('another session');expect(requiredElement<HTMLDialogElement>(view,'dialog').open).toBe(false);
 });
 it('drops late upload callbacks after leaving the page',async()=>{
  const held=deferred<Response>();const {calls,session}=source((_path,init)=>init.method==='POST'?held.promise:Response.json({images:[],maxImages:8}));
  const view=await renderWithSession(createElement(ProductImages,{productId:id,productName:'Synthetic'}),session);await choose(view);await unmountAll();
  await act(async()=>held.resolve(Response.json(image,{status:201})));await settle();expect(calls.filter(c=>c.init.method==='GET')).toHaveLength(1);
 });
});
