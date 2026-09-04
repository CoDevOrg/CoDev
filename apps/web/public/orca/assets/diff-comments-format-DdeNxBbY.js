function e(e){return e.source===`markdown`}function t(t){let n=t.body.replace(/\\/g,`\\\\`).replace(/"/g,`\\"`).replace(/\r/g,`\\r`).replace(/\n/g,`\\n`),r=t.lineNumber===0?`Scope: file`:t.startLine!==void 0&&t.startLine!==t.lineNumber?`Lines: ${t.startLine}-${t.lineNumber}`:`Line: ${t.lineNumber}`;return e(t)?[`File: ${t.filePath}`,`Source: markdown`,r,`User comment: "${n}"`].join(`
`):[`File: ${t.filePath}`,r,`User comment: "${n}"`].join(`
`)}function n(e){return e.map(t).join(`

`)}export{n,t};