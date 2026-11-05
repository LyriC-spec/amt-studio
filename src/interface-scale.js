const originalMedia = new WeakMap();
// CSS zoom enlarges the UI, but media queries still see the physical viewport.
// Scale our pixel breakpoints too, so the existing responsive layouts wrap at
// the same available content width as they do with browser zoom.
export function applyInterfaceScale(percent) {
 const factor=percent/100,root=document.documentElement;
 root.style.zoom=String(factor);
 root.style.setProperty('--ui-scale',String(factor));
 function visit(rules){for(const rule of rules){
  if(rule.type===CSSRule.MEDIA_RULE){
   if(!originalMedia.has(rule))originalMedia.set(rule,rule.media.mediaText);
   rule.media.mediaText=originalMedia.get(rule).replace(/((?:min|max)-(?:width|height)\s*:\s*)([\d.]+)px/g,(_,prefix,value)=>`${prefix}${Number(value)*factor}px`);
  }
  if(rule.cssRules)visit(rule.cssRules);
 }}
 for(const sheet of document.styleSheets){try{visit(sheet.cssRules)}catch{/* Ignore stylesheets from a different origin. */}}
}
