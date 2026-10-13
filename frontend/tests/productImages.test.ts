import { describe, expect, it } from 'vitest';
import { createProductImageClient, precheckImageFile, productImageSrc, projectProductImage, projectProductImageList } from '../src/lib/productImages';
const id='8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b';
const image={id,url:`/api/public/product-images/${id}.png`,contentType:'image/png',width:800,height:800,byteSize:10,altText:null,position:0,version:0,createdAt:'2026-10-08T09:30:00Z'};
describe('product image response and URL boundary',()=>{
 it.each(['\u00a0Front\u00a0','\ufeffFront\ufeff','\u2003Front\u2003'])('retains accepted Unicode alt boundaries %j',(altText)=>{
  expect(projectProductImage({...image,altText})).toEqual({...image,altText});
  expect(projectProductImageList({images:[{...image,altText}],maxImages:8})).toEqual({images:[{...image,altText}],maxImages:8});
 });
 it.each([' Front','Front ','\tFront','Front\n'])('rejects unnormalized or control-bearing alt %j',(altText)=>expect(projectProductImage({...image,altText})).toBeUndefined());
 it('accepts metadata without exposing unexpected fields',()=>expect(projectProductImage({...image,objectKey:'private'})).toEqual(image));
 it.each([{id:id.toUpperCase()},{url:'/api/staff/x.png'},{url:`/api/public/product-images/${id}.jpg`},{contentType:'image/svg+xml'},{width:4097},{height:0},{byteSize:3145729},{altText:'a'.repeat(161)},{altText:'a\nb'},{position:8},{version:-1},{createdAt:'today'}])('rejects malformed metadata %j',(change)=>expect(projectProductImage({...image,...change})).toBeUndefined());
 it('refuses duplicate identities and positions or a widened list limit',()=>{
  expect(projectProductImageList({images:[image,image],maxImages:8})).toBeUndefined();
  expect(projectProductImageList({images:[image],maxImages:9})).toBeUndefined();
 });
 it.each(['//evil.test/x.png','/api/staff/x.png','/api/public/product-images/../x.png',`/api/public/product-images/${id.toUpperCase()}.png`])('rejects unsafe source %s',(url)=>expect(productImageSrc(url)).toBeNull());
 it('resolves only accepted public paths on the API origin',()=>expect(productImageSrc(image.url,'https://api.example.test')).toBe(`https://api.example.test${image.url}`));
 it('prechecks exact size, declared type and extension',()=>{
  expect(precheckImageFile(new File([new Uint8Array(3145728)],'x.png',{type:'image/png'}))).toBeNull();
  expect(precheckImageFile(new File([new Uint8Array(3145729)],'x.png',{type:'image/png'}))).toBe('tooLarge');
  expect(precheckImageFile(new File(['x'],'x.webp',{type:'image/webp'}))).toBe('wrongType');
  expect(precheckImageFile(new File(['x'],'x.png',{type:'image/jpeg'}))).toBe('wrongType');
 });
});
describe('product image client',()=>{
 it('sends only named multipart fields and lets fetch select Content-Type',async()=>{
  let sent:RequestInit|undefined;
  const client=createProductImageClient({authenticatedFetch:async (_path,init,read)=>{sent=init;return read(Response.json(image,{status:201}));}});
  const file=new File(['png'],'x.png',{type:'image/png'});
  await client.upload({productId:id,id,file,altText:'front',replaces:id});
  expect(new Headers(sent?.headers).has('Content-Type')).toBe(false);
  expect(sent?.body).toBeInstanceOf(FormData);
  expect([...((sent?.body as FormData).keys())]).toEqual(['id','file','altText','replaces']);
 });
 it.each([200,202,500])('remove refuses status %s',async(status)=>{
  const client=createProductImageClient({authenticatedFetch:async (_path,_init,read)=>read(Response.json({}, {status}))});
  await expect(client.remove(id,id)).rejects.toMatchObject({status});
 });
 it('remove accepts only an empty 204 success',async()=>{
  const client=createProductImageClient({authenticatedFetch:async (_path,_init,read)=>read(new Response(null,{status:204}))});
  await expect(client.remove(id,id)).resolves.toBeUndefined();
 });
});
