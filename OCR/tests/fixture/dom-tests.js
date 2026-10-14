import { writable, locatorFor, resolveLocator, setField } from '/dist-ui/dom.js';
export async function runDomTests(){
 const results=[];
 const check=(name,ok)=>{results.push({name,passed:!!ok});if(!ok)throw new Error(name)};
 // Isolated DOM fixture fully in viewport, independent of manual test scroll position.
 const box=document.createElement('div');box.id='dom-test-box';box.style='position:fixed;left:0;top:0;width:280px;background:white;z-index:2147483646;padding:10px';
 box.innerHTML='<input id="test-field" type="text"><input id="test-pass" type="password"><input id="test-ro" readonly><input id="test-dis" disabled><input type="hidden" id="test-hidden"><input name="ambiguous"><input name="ambiguous">';document.body.append(box);
 try{
 const field=box.querySelector('#test-field');
 check('text field accepted',writable(field));
 for(const id of ['test-pass','test-ro','test-dis','test-hidden'])check(`${id} rejected`,!writable(box.querySelector('#'+id)));
 const locator=locatorFor(field,'field');check('stable locator resolves uniquely',resolveLocator(locator)===field);
 check('similar fields not guessed',!locatorFor(box.querySelector('[name=ambiguous]'),'field'));
 let events=[];field.addEventListener('input',()=>events.push('input'));field.addEventListener('change',()=>events.push('change'));
 await setField(field,'001234',()=>{});check('native setter preserves leading zero and emits events',field.value==='001234'&&events.join(',')==='input,change');
 field.addEventListener('input',()=>{field.value=''}, {once:true});let rejected=false;try{await setField(field,'123',()=>{})}catch{rejected=true}check('site rejecting value surfaces fill failure',rejected);
 const duplicate=field.cloneNode();box.append(duplicate);rejected=false;try{resolveLocator(locator)}catch{rejected=true}check('duplicate locator rejected',rejected);duplicate.remove();
 const old=field;field.replaceWith(field.cloneNode());check('replaced field identity differs',resolveLocator(locator)!==old);
 }catch(error){results.push({error:error.message,passed:false})}finally{box.remove()}
 for(const framework of ['react','vue']){
 const field=document.getElementById(framework+'-code');if(!field){results.push({name:framework+' controlled input',skipped:'local framework assets missing'});continue}
 field.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,100));
 try{await setField(field,'001234',()=>{});check(framework+' controlled input',document.getElementById(framework+'-value').textContent==='001234')}catch(error){results.push({name:framework,passed:false,error:error.message})}
 }
 return results;
}
