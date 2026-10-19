// @vitest-environment happy-dom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect} from 'vitest';
import {readHtmlPreviewImages} from '../../src/server/html-preview-images';
import {htmlPreviewImageReferences,embedHtmlPreviewImages} from '../../src/web/html-preview-images';
import {buildHtmlPreview} from '../../src/web/html-preview-compatibility';
it('renders local raster images, refreshes changed bytes and blocks escapes and scripts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'html-images-'));
 try{
  fs.mkdirSync(path.join(root,'gallery'));fs.mkdirSync(path.join(root,'gallery','webp'));
  const bytes=Buffer.from('RIFF0000WEBP');
  fs.writeFileSync(path.join(root,'gallery','webp','한 글.webp'),bytes);
  fs.writeFileSync(path.join(root,'gallery','fake.png'),'secret');
  fs.symlinkSync('/etc/passwd',path.join(root,'gallery','link.png'));
  const src='<img src="webp/%ED%95%9C%20%EA%B8%80.webp?v=1"><img src="fake.png"><img src="../../outside.png"><img src="link.png"><img src="https://example.com/a.png"><script>alert(1)</script>';
  const refs=htmlPreviewImageReferences(src);
  expect(refs).toHaveLength(4);
  const images=readHtmlPreviewImages(root,path.join(root,'gallery','index.html'),refs);
  expect(Object.keys(images)).toEqual(['webp/%ED%95%9C%20%EA%B8%80.webp?v=1']);
  const doc=new DOMParser().parseFromString(buildHtmlPreview(embedHtmlPreviewImages(src,images),{mode:'safe',allowExternalImages:false}).srcdoc,'text/html');
  expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/webp;base64,'+bytes.toString('base64'));
  expect(doc.querySelectorAll('img[src]')).toHaveLength(1);expect(doc.querySelector('script')).toBeNull();
  fs.writeFileSync(path.join(root,'gallery','webp','한 글.webp'),Buffer.from('RIFF1111WEBP'));
  expect(readHtmlPreviewImages(root,path.join(root,'gallery','index.html'),refs)).not.toEqual(images);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
