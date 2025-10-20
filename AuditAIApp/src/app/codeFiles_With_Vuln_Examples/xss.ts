// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// File: sample.ts
const userInput = '<script>alert("XSS vulnerability");</script>';
const message = `Hello, ${userInput}!`;
document.getElementById('output').innerHTML = message;
