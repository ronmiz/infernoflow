import{buildResume as s,renderResume as i}from"../memoryView.mjs";async function r(n=[]){const e=n.indexOf("--file"),l=e!==-1?n[e+1]:null,o=s(process.cwd(),{file:l});if(n.includes("--json")){console.log(JSON.stringify(o,null,2));return}console.log(`
`+i(o)+`
`)}export{r as resumeCommand};
