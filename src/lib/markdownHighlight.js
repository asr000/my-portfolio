import rehypeHighlight from 'rehype-highlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import 'highlight.js/styles/github-dark.css'

export const highlightPlugin = [rehypeHighlight, {
  detect: false,
  languages: { javascript, typescript, python, cpp, c, css, xml, json, bash, sql },
}]
