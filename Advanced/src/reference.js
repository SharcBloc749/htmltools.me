export const reference = [
  {
    "n": "<!DOCTYPE html>",
    "c": "html",
    "d": "Required first line. Tells browser this is HTML5.",
    "e": "<!DOCTYPE html>"
  },
  {
    "n": "<html>",
    "c": "html",
    "d": "Root element. Always include lang for accessibility.",
    "e": "<html lang=\"en\">...</html>"
  },
  {
    "n": "<head>",
    "c": "html",
    "d": "Meta info, title, CSS links. Nothing visible here.",
    "e": "<head>\n  <title>Page</title>\n</head>"
  },
  {
    "n": "<body>",
    "c": "html",
    "d": "All visible page content goes here.",
    "e": "<body>\n  <h1>Hello</h1>\n</body>"
  },
  {
    "n": "<title>",
    "c": "html",
    "d": "Sets the browser tab title.",
    "e": "<title>My Page</title>"
  },
  {
    "n": "<meta charset>",
    "c": "html",
    "d": "Sets character encoding. Always include this.",
    "e": "<meta charset=\"UTF-8\">"
  },
  {
    "n": "<meta viewport>",
    "c": "html",
    "d": "Makes site responsive on mobile devices.",
    "e": "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
  },
  {
    "n": "<link>",
    "c": "html",
    "d": "Links external files like CSS stylesheets.",
    "e": "<link rel=\"stylesheet\" href=\"style.css\">"
  },
  {
    "n": "<script>",
    "c": "html",
    "d": "Embeds or links JavaScript.",
    "e": "<script src=\"app.js\"></script>"
  },
  {
    "n": "<style>",
    "c": "html",
    "d": "Embeds CSS directly inside HTML.",
    "e": "<style>\n  body { color: red; }\n</style>"
  },
  {
    "n": "<h1> to <h6>",
    "c": "html",
    "d": "Headings. h1 is biggest/most important. Only one h1 per page.",
    "e": "<h1>Main Title</h1>\n<h2>Sub Heading</h2>\n<h3>Smaller</h3>"
  },
  {
    "n": "<p>",
    "c": "html",
    "d": "A paragraph of text.",
    "e": "<p>This is a paragraph.</p>"
  },
  {
    "n": "<br>",
    "c": "html",
    "d": "Line break. Self-closing.",
    "e": "First line<br>Second line"
  },
  {
    "n": "<hr>",
    "c": "html",
    "d": "Horizontal divider line.",
    "e": "<p>Above</p>\n<hr>\n<p>Below</p>"
  },
  {
    "n": "<strong>",
    "c": "html",
    "d": "Bold and semantically important text.",
    "e": "<p>This is <strong>important</strong>.</p>"
  },
  {
    "n": "<em>",
    "c": "html",
    "d": "Italic with emphasis meaning.",
    "e": "<p>This is <em>emphasized</em>.</p>"
  },
  {
    "n": "<span>",
    "c": "html",
    "d": "Inline container for styling part of text.",
    "e": "<p>Hello <span style=\"color:red\">World</span></p>"
  },
  {
    "n": "<div>",
    "c": "html",
    "d": "Block-level container for grouping elements.",
    "e": "<div class=\"card\">\n  <p>Content</p>\n</div>"
  },
  {
    "n": "<a>",
    "c": "html",
    "d": "Hyperlink. target=\"_blank\" opens in new tab.",
    "e": "<a href=\"https://google.com\" target=\"_blank\">Click me</a>"
  },
  {
    "n": "<img>",
    "c": "html",
    "d": "Embeds an image. Always add alt text!",
    "e": "<img src=\"photo.jpg\" alt=\"Description\" width=\"300\">"
  },
  {
    "n": "<ul>",
    "c": "html",
    "d": "Unordered (bullet) list.",
    "e": "<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n</ul>"
  },
  {
    "n": "<ol>",
    "c": "html",
    "d": "Ordered (numbered) list.",
    "e": "<ol>\n  <li>First</li>\n  <li>Second</li>\n</ol>"
  },
  {
    "n": "<li>",
    "c": "html",
    "d": "List item inside ul or ol.",
    "e": "<ul>\n  <li>My item</li>\n</ul>"
  },
  {
    "n": "<table>",
    "c": "html",
    "d": "Creates a data table.",
    "e": "<table>\n  <tr><th>Name</th><th>Age</th></tr>\n  <tr><td>Alice</td><td>30</td></tr>\n</table>"
  },
  {
    "n": "<form>",
    "c": "html",
    "d": "Form for collecting user input.",
    "e": "<form action=\"/submit\" method=\"post\">\n  <input type=\"text\" name=\"name\">\n  <button type=\"submit\">Go</button>\n</form>"
  },
  {
    "n": "<input>",
    "c": "html",
    "d": "Form field. Type controls behavior.",
    "e": "<input type=\"text\" placeholder=\"Name\">\n<input type=\"email\" required>\n<input type=\"checkbox\" checked>"
  },
  {
    "n": "<button>",
    "c": "html",
    "d": "Clickable button.",
    "e": "<button onclick=\"alert('Hi!')\">Click Me</button>"
  },
  {
    "n": "<textarea>",
    "c": "html",
    "d": "Multi-line text input.",
    "e": "<textarea rows=\"4\" placeholder=\"Type here...\"></textarea>"
  },
  {
    "n": "<select>",
    "c": "html",
    "d": "Dropdown menu.",
    "e": "<select>\n  <option value=\"a\">Option A</option>\n  <option value=\"b\">Option B</option>\n</select>"
  },
  {
    "n": "<label>",
    "c": "html",
    "d": "Label for a form field. Links with for attribute.",
    "e": "<label for=\"email\">Email:</label>\n<input id=\"email\" type=\"email\">"
  },
  {
    "n": "<nav>",
    "c": "html",
    "d": "Navigation links section.",
    "e": "<nav>\n  <a href=\"/\">Home</a>\n  <a href=\"/about\">About</a>\n</nav>"
  },
  {
    "n": "<header>",
    "c": "html",
    "d": "Page or section header.",
    "e": "<header>\n  <h1>My Site</h1>\n</header>"
  },
  {
    "n": "<footer>",
    "c": "html",
    "d": "Page or section footer.",
    "e": "<footer>\n  <p>Copyright 2025</p>\n</footer>"
  },
  {
    "n": "<main>",
    "c": "html",
    "d": "Main content area. Use once per page.",
    "e": "<main>\n  <h1>Welcome</h1>\n</main>"
  },
  {
    "n": "<section>",
    "c": "html",
    "d": "Thematic group of content.",
    "e": "<section>\n  <h2>About</h2>\n  <p>Info here.</p>\n</section>"
  },
  {
    "n": "<article>",
    "c": "html",
    "d": "Self-contained content like a blog post.",
    "e": "<article>\n  <h2>Post Title</h2>\n  <p>Content.</p>\n</article>"
  },
  {
    "n": "<aside>",
    "c": "html",
    "d": "Side content like a sidebar.",
    "e": "<aside>\n  <p>Related links</p>\n</aside>"
  },
  {
    "n": "<details>",
    "c": "html",
    "d": "Built-in collapsible widget.",
    "e": "<details>\n  <summary>Click to expand</summary>\n  <p>Hidden content here.</p>\n</details>"
  },
  {
    "n": "<video>",
    "c": "html",
    "d": "Embeds a video.",
    "e": "<video src=\"clip.mp4\" controls width=\"400\"></video>"
  },
  {
    "n": "<audio>",
    "c": "html",
    "d": "Embeds audio.",
    "e": "<audio src=\"sound.mp3\" controls></audio>"
  },
  {
    "n": "<iframe>",
    "c": "html",
    "d": "Embeds another webpage.",
    "e": "<iframe src=\"https://example.com\" width=\"600\" height=\"400\"></iframe>"
  },
  {
    "n": "<canvas>",
    "c": "html",
    "d": "Drawing surface for JavaScript graphics.",
    "e": "<canvas id=\"c\" width=\"400\" height=\"200\"></canvas>"
  },
  {
    "n": "<code>",
    "c": "html",
    "d": "Inline code snippet.",
    "e": "<p>Use <code>console.log()</code> to debug.</p>"
  },
  {
    "n": "<pre>",
    "c": "html",
    "d": "Preformatted text, preserves spaces and newlines.",
    "e": "<pre>  Line 1\n  Line 2</pre>"
  },
  {
    "n": "<blockquote>",
    "c": "html",
    "d": "A quoted block of text.",
    "e": "<blockquote>\n  A famous quote here.\n</blockquote>"
  },
  {
    "n": "data-* attribute",
    "c": "html",
    "d": "Custom data stored on any element.",
    "e": "<div data-user-id=\"42\" data-role=\"admin\">User</div>"
  },
  {
    "n": "class attribute",
    "c": "html",
    "d": "Assigns CSS class(es) to an element.",
    "e": "<div class=\"card active\">Content</div>"
  },
  {
    "n": "id attribute",
    "c": "html",
    "d": "Unique identifier for one specific element.",
    "e": "<div id=\"main-header\">Header</div>"
  },
  {
    "n": "color",
    "c": "css",
    "d": "Sets the text color.",
    "e": "p { color: #333; }\nh1 { color: rgb(255, 0, 0); }"
  },
  {
    "n": "background",
    "c": "css",
    "d": "Background color or image.",
    "e": ".box { background: #f0f0f0; }\n.hero { background: linear-gradient(to right, #667eea, #764ba2); }"
  },
  {
    "n": "font-size",
    "c": "css",
    "d": "Text size. px=fixed, rem=relative to root.",
    "e": "p { font-size: 16px; }\nh1 { font-size: 2.5rem; }"
  },
  {
    "n": "font-family",
    "c": "css",
    "d": "Sets the font. Always include a fallback.",
    "e": "body { font-family: 'Roboto', sans-serif; }"
  },
  {
    "n": "font-weight",
    "c": "css",
    "d": "Text boldness. 400=normal, 700=bold.",
    "e": "p { font-weight: 400; }\nstrong { font-weight: 700; }"
  },
  {
    "n": "margin",
    "c": "css",
    "d": "Space OUTSIDE the element.",
    "e": ".card { margin: 20px; }\n.box { margin: 10px 20px; }"
  },
  {
    "n": "padding",
    "c": "css",
    "d": "Space INSIDE the element.",
    "e": ".card { padding: 20px; }\n.btn { padding: 10px 24px; }"
  },
  {
    "n": "border",
    "c": "css",
    "d": "Element border: width style color.",
    "e": ".box { border: 1px solid #ccc; }"
  },
  {
    "n": "border-radius",
    "c": "css",
    "d": "Rounds corners. 50% makes a circle.",
    "e": ".card { border-radius: 8px; }\n.avatar { border-radius: 50%; }"
  },
  {
    "n": "width / height",
    "c": "css",
    "d": "Sets element dimensions.",
    "e": ".box { width: 300px; height: 200px; }\n.full { width: 100%; }"
  },
  {
    "n": "display",
    "c": "css",
    "d": "Controls how element behaves in layout.",
    "e": ".row { display: flex; }\n.grid { display: grid; }\n.hide { display: none; }"
  },
  {
    "n": "flexbox",
    "c": "css",
    "d": "Powerful 1D layout for rows or columns.",
    "e": ".container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  gap: 16px;\n  flex-wrap: wrap;\n}"
  },
  {
    "n": "CSS Grid",
    "c": "css",
    "d": "2D layout system for rows and columns.",
    "e": ".grid {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 16px;\n}"
  },
  {
    "n": "position",
    "c": "css",
    "d": "How element is positioned on the page.",
    "e": ".rel { position: relative; }\n.fixed { position: fixed; top: 0; left: 0; }"
  },
  {
    "n": "z-index",
    "c": "css",
    "d": "Stacking order of overlapping elements.",
    "e": ".modal { z-index: 1000; }"
  },
  {
    "n": "overflow",
    "c": "css",
    "d": "What happens when content is too big.",
    "e": ".scroll { overflow: auto; }\n.clip { overflow: hidden; }"
  },
  {
    "n": "box-shadow",
    "c": "css",
    "d": "Drop shadow around an element.",
    "e": ".card { box-shadow: 0 4px 12px rgba(0,0,0,0.15); }"
  },
  {
    "n": "text-align",
    "c": "css",
    "d": "Horizontal alignment of text.",
    "e": "h1 { text-align: center; }"
  },
  {
    "n": "transition",
    "c": "css",
    "d": "Smoothly animate property changes.",
    "e": ".btn { background: blue; transition: background 0.3s ease; }\n.btn:hover { background: darkblue; }"
  },
  {
    "n": "animation",
    "c": "css",
    "d": "CSS keyframe animations.",
    "e": "@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n.el { animation: fadeIn 0.5s ease; }"
  },
  {
    "n": "opacity",
    "c": "css",
    "d": "Transparency. 0=invisible, 1=fully visible.",
    "e": ".faded { opacity: 0.5; }"
  },
  {
    "n": "transform",
    "c": "css",
    "d": "Rotate, scale, or move elements visually.",
    "e": ".spin { transform: rotate(45deg); }\n.big { transform: scale(1.2); }"
  },
  {
    "n": ":hover",
    "c": "css",
    "d": "Applied when mouse hovers the element.",
    "e": "a:hover { color: blue; }"
  },
  {
    "n": ":focus",
    "c": "css",
    "d": "Applied when element is focused.",
    "e": "input:focus { border-color: blue; outline: none; }"
  },
  {
    "n": "::before/::after",
    "c": "css",
    "d": "Adds content before or after an element.",
    "e": ".item::before { content: \"-> \"; color: red; }"
  },
  {
    "n": "CSS Variables",
    "c": "css",
    "d": "Reusable values. Define in :root.",
    "e": ":root { --primary: #3b82f6; }\n.btn { background: var(--primary); }"
  },
  {
    "n": "@media query",
    "c": "css",
    "d": "Apply styles for specific screen sizes.",
    "e": "@media (max-width: 768px) { .sidebar { display: none; } }"
  },
  {
    "n": "clamp()",
    "c": "css",
    "d": "Fluid value between a min and max.",
    "e": "h1 { font-size: clamp(1.2rem, 4vw, 3rem); }"
  },
  {
    "n": "gap",
    "c": "css",
    "d": "Space between flex or grid children.",
    "e": ".flex { display: flex; gap: 16px; }"
  },
  {
    "n": "cursor",
    "c": "css",
    "d": "Changes the mouse cursor style.",
    "e": ".btn { cursor: pointer; }"
  },
  {
    "n": "object-fit",
    "c": "css",
    "d": "How img/video fills its container.",
    "e": "img { width: 100%; height: 200px; object-fit: cover; }"
  },
  {
    "n": "line-height",
    "c": "css",
    "d": "Vertical spacing between lines of text.",
    "e": "p { line-height: 1.6; }"
  },
  {
    "n": "list-style",
    "c": "css",
    "d": "Bullet or number style for lists.",
    "e": "ul { list-style: none; }"
  },
  {
    "n": "console.log()",
    "c": "js",
    "d": "Prints a value to the console.",
    "e": "console.log('Hello!');\nconsole.log(42, [1,2,3]);"
  },
  {
    "n": "getElementById()",
    "c": "js",
    "d": "Selects one element by its id.",
    "e": "const btn = document.getElementById('myBtn');\nbtn.style.color = 'red';"
  },
  {
    "n": "querySelector()",
    "c": "js",
    "d": "Selects first matching element (CSS selector).",
    "e": "const h = document.querySelector('h1');"
  },
  {
    "n": "querySelectorAll()",
    "c": "js",
    "d": "Selects ALL matching elements.",
    "e": "const items = document.querySelectorAll('li');\nitems.forEach(item => console.log(item.textContent));"
  },
  {
    "n": "addEventListener()",
    "c": "js",
    "d": "Runs a function when an event happens.",
    "e": "document.getElementById('btn').addEventListener('click', function() {\n  alert('Clicked!');\n});"
  },
  {
    "n": "innerHTML",
    "c": "js",
    "d": "Get or set HTML inside an element.",
    "e": "document.getElementById('box').innerHTML = '<b>Hello!</b>';"
  },
  {
    "n": "textContent",
    "c": "js",
    "d": "Get or set plain text (safer than innerHTML).",
    "e": "document.getElementById('label').textContent = 'Updated';"
  },
  {
    "n": "classList",
    "c": "js",
    "d": "Add, remove, or toggle CSS classes.",
    "e": "const el = document.getElementById('box');\nel.classList.add('active');\nel.classList.toggle('dark');"
  },
  {
    "n": "style property",
    "c": "js",
    "d": "Set inline CSS on an element.",
    "e": "const el = document.querySelector('.box');\nel.style.backgroundColor = 'red';"
  },
  {
    "n": "createElement()",
    "c": "js",
    "d": "Creates a new HTML element.",
    "e": "const div = document.createElement('div');\ndiv.textContent = 'New!';\ndocument.body.appendChild(div);"
  },
  {
    "n": "setTimeout()",
    "c": "js",
    "d": "Runs a function once after a delay (ms).",
    "e": "setTimeout(function() {\n  console.log('1 second later!');\n}, 1000);"
  },
  {
    "n": "setInterval()",
    "c": "js",
    "d": "Repeats a function at set intervals.",
    "e": "const t = setInterval(() => console.log('Tick'), 1000);\n// Stop: clearInterval(t);"
  },
  {
    "n": "fetch()",
    "c": "js",
    "d": "Makes HTTP requests to APIs.",
    "e": "fetch('https://api.example.com/data')\n  .then(res => res.json())\n  .then(data => console.log(data));"
  },
  {
    "n": "localStorage",
    "c": "js",
    "d": "Store data that persists after page closes.",
    "e": "localStorage.setItem('name', 'Alice');\nconst name = localStorage.getItem('name');"
  },
  {
    "n": "JSON.stringify()",
    "c": "js",
    "d": "Convert object/array to a JSON string.",
    "e": "const obj = {name: 'Alice', age: 30};\nconsole.log(JSON.stringify(obj));"
  },
  {
    "n": "JSON.parse()",
    "c": "js",
    "d": "Parse a JSON string into an object.",
    "e": "const obj = JSON.parse('{\"name\":\"Alice\"}');\nconsole.log(obj.name);"
  },
  {
    "n": "Array.map()",
    "c": "js",
    "d": "Returns new array by transforming each item.",
    "e": "const doubled = [1,2,3].map(n => n*2);"
  },
  {
    "n": "Array.filter()",
    "c": "js",
    "d": "Returns new array with only matching items.",
    "e": "const evens = [1,2,3,4].filter(n => n%2===0);"
  },
  {
    "n": "Array.forEach()",
    "c": "js",
    "d": "Runs a function for each array item.",
    "e": "['a','b','c'].forEach((item,i) => console.log(i, item));"
  },
  {
    "n": "Array.find()",
    "c": "js",
    "d": "Returns first item matching condition.",
    "e": "const u = users.find(x => x.id===2);"
  },
  {
    "n": "Math methods",
    "c": "js",
    "d": "Built-in math utilities.",
    "e": "Math.random();\nMath.floor(4.7); // 4\nMath.ceil(4.1);  // 5\nMath.max(1,2,3); // 3"
  },
  {
    "n": "String methods",
    "c": "js",
    "d": "Common text manipulation.",
    "e": "const s = 'Hello World';\ns.toLowerCase();\ns.includes('World');\ns.split(' ');\ns.replace('World','JS');"
  },
  {
    "n": "if / else",
    "c": "js",
    "d": "Conditional branching.",
    "e": "if (age >= 18) {\n  console.log('Adult');\n} else {\n  console.log('Minor');\n}"
  },
  {
    "n": "for loop",
    "c": "js",
    "d": "Repeat code a fixed number of times.",
    "e": "for (let i = 0; i < 5; i++) {\n  console.log(\"Step \" + i);\n}"
  },
  {
    "n": "function",
    "c": "js",
    "d": "A reusable block of code.",
    "e": "function greet(name) {\n  return 'Hello, ' + name;\n}"
  },
  {
    "n": "arrow function",
    "c": "js",
    "d": "Shorter function syntax with =>",
    "e": "const add = (a, b) => a + b;\nconsole.log(add(2, 3)); // 5"
  },
  {
    "n": "async / await",
    "c": "js",
    "d": "Handle async operations cleanly.",
    "e": "async function load() {\n  const res = await fetch('/api');\n  const data = await res.json();\n  console.log(data);\n}"
  },
  {
    "n": "try / catch",
    "c": "js",
    "d": "Handle errors without crashing.",
    "e": "try {\n  JSON.parse('bad');\n} catch(e) {\n  console.error('Error:', e.message);\n}"
  },
  {
    "n": "spread ...",
    "c": "js",
    "d": "Expand arrays or objects.",
    "e": "const b=[...a,4,5];\nconst o2={...obj, y:2};"
  },
  {
    "n": "destructuring",
    "c": "js",
    "d": "Extract values from arrays or objects.",
    "e": "const [a,b]=[1,2];\nconst {name,age}=person;"
  },
  {
    "n": "template literals",
    "c": "js",
    "d": "Strings with embedded expressions.",
    "e": "const name=\"World\";\nconsole.log(\"Hello, \"+name+\"!\");"
  },
  {
    "n": "class",
    "c": "js",
    "d": "Blueprint for creating objects.",
    "e": "class Animal {\n  constructor(name){this.name=name;}\n  speak(){return this.name+\" says hi!\";}\n}"
  },
  {
    "n": "ternary operator",
    "c": "js",
    "d": "One-line if/else.",
    "e": "const s = age>=18 ? 'adult' : 'minor';"
  },
  {
    "n": "Object.keys()",
    "c": "js",
    "d": "Get all keys of an object as an array.",
    "e": "Object.keys({a:1,b:2}); // ['a','b']"
  },
  {
    "n": "TypeScript types",
    "c": "ts",
    "d": "TypeScript is compiled locally. Run the .ts entry, or reference it with a module script.",
    "e": "type Person = { name: string };\nconst user: Person = { name: \"Maker\" };\nconsole.log(user.name);"
  },
  {
    "n": "Import a local module",
    "c": "ts",
    "d": "Relative imports resolve files in your project, including extensionless .ts and .js paths.",
    "e": "import { greet } from \"./greet\";\nconsole.log(greet(\"World\"));"
  },
  {
    "n": "Python functions",
    "c": "py",
    "d": "Run Python 3 with the standard library in a separate, stoppable worker.",
    "e": "def greet(name):\n    return f\"Hello, {name}!\"\n\nprint(greet(\"World\"))"
  },
  {
    "n": "Read project files",
    "c": "py",
    "d": "Every project file is available under /workspace. Local Python modules work too.",
    "e": "from pathlib import Path\ntext = Path(\"README.md\").read_text()\nprint(text)"
  },
  {
    "n": "Python JSON",
    "c": "py",
    "d": "The Python standard library includes json, math, pathlib, datetime, and more.",
    "e": "import json\ndata = json.loads('{\"ready\": true}')\nprint(data[\"ready\"])"
  },
  {
    "n": "Markdown basics",
    "c": "md",
    "d": "Choose a .md entry to preview formatted text. Raw HTML is sanitized.",
    "e": "# My project\n\nA **bold** idea, an _experiment_.\n\n- Make something\n- Keep learning"
  },
  {
    "n": "Project data with fetch",
    "c": "js",
    "d": "Fetch relative project files from your browser code. No server required.",
    "e": "const response = await fetch(\"./data.json\");\nconst data = await response.json();\nconsole.log(data);"
  }
];
