// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductImage } from '../src/catalog/ProductImage';
import { renderWithSession, requiredElement, unmountAll } from './renderWithSession';
vi.mock('next/navigation',()=>({usePathname:()=>'/staff/products'}));
vi.mock('next/image',()=>({default:(props:React.ImgHTMLAttributes<HTMLImageElement>)=>createElement('img',props)}));
const image={id:'8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b',url:'/api/public/product-images/8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b.png',contentType:'image/png' as const,width:800,height:600,byteSize:10,altText:null,position:0,version:0,createdAt:'2026-10-08T09:30:00Z'};
afterEach(unmountAll);
it('renders dimensions, accessible alt and responsive sizes',async()=>{
 const view=await renderWithSession(createElement(ProductImage,{image,alt:'Synthetic front',sizes:'25vw'}));
 const img=requiredElement<HTMLImageElement>(view,'img');
 expect([img.width,img.height,img.alt,img.sizes]).toEqual([800,600,'Synthetic front','25vw']);
 await act(async()=>img.dispatchEvent(new Event('error')));
 expect(requiredElement(view,'[role="img"]').getAttribute('aria-label')).toBe('Synthetic front');
});
it('refuses an unsafe source before rendering an image',async()=>{
 const view=await renderWithSession(createElement(ProductImage,{image:{...image,url:'//evil.test/a.png'},alt:'Synthetic front',sizes:'25vw'}));
 expect(view.querySelector('img')).toBeNull();
 expect(requiredElement(view,'.image-placeholder').getAttribute('aria-label')).toBe('Synthetic front');
});
it('renders the shared accessible placeholder when no image is available',async()=>{
 const view=await renderWithSession(createElement(ProductImage,{image:null,alt:'Product name',sizes:'50vw'}));
 expect(view.querySelector('img')).toBeNull();
 expect(requiredElement(view,'[role="img"]').getAttribute('aria-label')).toBe('Product name');
});
