import { runDomTests } from './dom-tests.js';
const $=id=>document.getElementById(id);
const svg=text=>`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><rect width="220" height="70" fill="white"/><text x="18" y="49" font-size="40" font-family="Arial" font-weight="bold" fill="black">${text}</text></svg>`;
let value='001234', clicks=0, timer, inputCount=0, changeCount=0;
function draw(){ $('captcha-img').src='data:image/svg+xml;base64,'+btoa(svg(value)); const ctx=$('captcha-canvas').getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,220,70);ctx.fillStyle='black';ctx.font='bold 40px Arial';ctx.fillText(value,18,49);$('background-image').style.backgroundImage=`url("data:image/svg+xml;base64,${btoa(svg(value))}")`; }
function refresh(){value=value==='001234'?'009876':'001234';draw()}
$('captcha-img').onclick=()=>{$('clicks').textContent=String(++clicks);refresh()};
$('refresh').onclick=refresh;$('reset').onclick=()=>{value='001234';draw()};
$('english').onclick=()=>{value='A7b3Z9';draw()};
$('timer').onclick=()=>{if(timer){clearInterval(timer);timer=undefined}else timer=setInterval(refresh,1000)};
$('redraw').onclick=()=>{const ctx=$('captcha-canvas').getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,220,70);ctx.fillStyle='black';ctx.fillText('009876',18,49)};
$('same-refresh').onclick=async()=>{await fetch('/toggle',{method:'POST'});$('same-src').src='/captcha.svg'};
$('native-code').addEventListener('input',()=>{$('native-events').textContent=`${++inputCount} / ${changeCount}`});
$('native-code').addEventListener('change',()=>{$('native-events').textContent=`${inputCount} / ${++changeCount}`});
$('duplicate').onclick=()=>{$('captcha-img').after($('captcha-img').cloneNode())};
$('replace').onclick=()=>{$('native-code').replaceWith($('native-code').cloneNode())};
$('shift').onclick=()=>{document.querySelector('header').style.paddingBottom='80px'};
$('dom-tests').onclick=async()=>{$('dom-results').textContent=JSON.stringify(await runDomTests(),null,2)};
window.runDomTests=runDomTests;
let reactKey=0,vueKey;
if(window.React&&window.ReactDOM&&window.Vue){
 const {createElement:h,useState}=React;const root=ReactDOM.createRoot($('react-root'));
 function Controlled(){const [text,setText]=useState('');return h('label',null,'React',h('input',{id:'react-code',value:text,onChange:e=>setText(e.target.value)}),h('output',{id:'react-value'},text))}
 const mountReact=()=>root.render(h(Controlled,{key:reactKey++}));mountReact();$('react-remount').onclick=mountReact;
 Vue.createApp({setup(){const text=Vue.ref('');vueKey=Vue.ref(0);return()=>Vue.h('label',null,['Vue',Vue.h('input',{id:'vue-code',key:vueKey.value,value:text.value,onInput:e=>text.value=e.target.value}),Vue.h('output',{id:'vue-value'},text.value)])}}).mount('#vue-root');
 $('vue-remount').onclick=()=>{vueKey.value++};$('framework-status').textContent='React / Vue 已由本機檔案載入。';
}else $('framework-status').textContent='React / Vue 資源尚未安裝；框架測試未執行。';
let last=performance.now(),maxGap=0;
function tick(now){maxGap=Math.max(maxGap,now-last);last=now;$('tick').textContent=`UI requestAnimationFrame 最大間隔：${maxGap.toFixed(1)} ms（包含背景分頁暫停）`;requestAnimationFrame(tick)}
draw();requestAnimationFrame(tick);
