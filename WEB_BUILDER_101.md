# Web Builder 101: VS Code + AI + Budget Workflow

This guide is designed for solo creators on a tight budget.

## Part A: Lingo You Must Know

- Frontend: What users see in the browser
- Backend: Server logic and data handling
- Full stack: Frontend + backend together
- Static site: Prebuilt pages with little server logic
- Dynamic site: Pages generated using logic/data
- Domain: Your web address, like xanseye.com
- DNS: The phonebook that points domain to host
- Hosting: The server platform running your site
- SSL certificate: Encrypts traffic (https)
- Repository: Folder tracked with Git history
- Commit: A saved snapshot of your code changes
- Branch: A parallel version of your code
- Pull request: Proposed changes before merging
- Merge: Combining branch changes into main
- Deploy: Publishing code to production
- Build: Compiling and optimizing code for deploy
- Environment variable: Secret/config value outside code
- API: Interface for apps to communicate
- Endpoint: Specific API URL
- Middleware: Logic that runs between request and response
- Component: Reusable UI block
- Props: Data passed into components
- State: Data that changes in the UI
- Route: URL path in your app
- Redirect: Auto-forward one URL to another
- 404: Page not found
- 301: Permanent redirect for SEO
- Accessibility (a11y): Usable by everyone
- Responsive design: Adapts to phone/tablet/desktop
- Lighthouse: Site quality/performance checker
- Technical debt: Future work created by shortcuts

## Part B: 101 Lessons

### Mindset and Planning
1. Define the one main action your site should drive.
2. Write a one-sentence promise for your homepage.
3. Keep navigation to 5-7 key links max.
4. Draft your site map before writing code.
5. Decide your content hierarchy before styling.
6. Prioritize mobile layout first.
7. Keep a simple brand kit: colors, fonts, tone.
8. Use plain words over clever words.
9. Keep each page focused on one goal.
10. Ship version 1 fast, then improve weekly.

### VS Code Fundamentals
11. Learn Explorer, Search, Source Control, Extensions panels.
12. Use Command Palette for almost everything.
13. Learn keyboard shortcuts for split editor and terminal.
14. Keep one integrated terminal for project commands.
15. Install only essential extensions to avoid slowdown.
16. Use workspace settings per project.
17. Use format on save for consistency.
18. Use Problems panel as your error dashboard.
19. Use global search for fast refactors.
20. Use breadcrumbs to understand file location.

### Git and Safety
21. Initialize Git on every project.
22. Commit small, meaningful chunks.
23. Write commit messages as actions.
24. Create a branch for each feature.
25. Never edit production directly.
26. Push daily to remote backup.
27. Tag stable releases.
28. Revert with Git instead of manual undo.
29. Review diffs before each commit.
30. Keep main branch always deployable.

### HTML and Structure
31. Use semantic elements: header, main, section, footer.
32. Keep one h1 per page.
33. Nest headings in order.
34. Use descriptive link text.
35. Add alt text to images.
36. Keep forms simple with clear labels.
37. Avoid div soup; structure content intentionally.
38. Keep metadata title and description unique per page.
39. Use lists for grouped info.
40. Keep paragraphs short and skimmable.

### CSS and Visual Design
41. Start with spacing scale and typography scale.
42. Use CSS variables for brand colors.
43. Set max-width for readable text.
44. Use consistent border radius and shadows.
45. Design for touch targets on mobile.
46. Prefer simple transitions over heavy animation.
47. Build reusable classes for repeated patterns.
48. Test contrast for readability.
49. Keep layout systems simple: flex and grid.
50. Avoid pixel-perfect obsession; optimize flow first.

### JavaScript and Interactivity
51. Add interaction only when it supports goals.
52. Keep functions small and named clearly.
53. Handle loading, success, and error states.
54. Validate user input early.
55. Avoid unnecessary dependencies.
56. Debounce expensive interactions.
57. Use async/await for readability.
58. Log useful errors in development.
59. Remove debug logs before production.
60. Keep business logic separate from UI markup.

### Next.js and App Workflow
61. Use route folders for each page.
62. Keep shared layout/components centralized.
63. Use static pages when possible for speed.
64. Use server routes only when needed.
65. Optimize images for web sizes.
66. Keep metadata set for SEO basics.
67. Reuse section components across pages.
68. Keep content text in obvious files.
69. Run build before every deploy.
70. Treat warnings as tasks, not noise.

### Quality and Debugging
71. Reproduce bugs in smallest scenario first.
72. Change one variable at a time.
73. Use browser dev tools for layout/debug.
74. Check mobile and desktop before shipping.
75. Test all nav links and buttons.
76. Verify external links open correctly.
77. Test slow network behavior.
78. Validate contact details and business info.
79. Keep a pre-launch checklist.
80. Fix root causes, not symptoms.

### SEO and Content
81. Match page title to user intent.
82. Use human-friendly URLs.
83. Add internal links between key pages.
84. Keep image filenames descriptive.
85. Compress images for performance.
86. Add location/service keywords naturally.
87. Keep copy benefit-focused.
88. Add trust signals: awards, publications, testimonials.
89. Use clear call-to-action language.
90. Update content monthly for freshness.

### Hosting, Domain, and Ops
91. Use Vercel for Next.js to reduce complexity.
92. Keep DNS simple: apex and www only.
93. Verify SSL after DNS changes.
94. Keep old host active during migration window.
95. Monitor uptime after launch.
96. Use Cloudflare Registrar for low renewal costs.
97. Store credentials in a password manager.
98. Enable two-factor auth on hosting and registrar.
99. Keep a rollback plan for launch day.
100. Document your setup in one project README.
101. Schedule weekly 1-hour improvements for compounding growth.

## Part C: Using AI in VS Code (Copilot or Claude)

- Ask for one concrete task at a time.
- Give context: goal, constraints, target file.
- Ask for smallest safe change first.
- Always ask AI to run build/tests after edits.
- Ask AI to explain diff in plain language.
- Request checklists when doing deploy or DNS work.
- Ask AI for alternatives with tradeoffs.
- Keep prompts reusable in a notes file.
- Save good prompts as templates.
- Use AI for drafts, then apply your brand voice.

Prompt templates:
- Build this page from this outline. Keep mobile-first and SEO-friendly.
- Refactor this component to be reusable without changing behavior.
- Find accessibility issues in these files and fix them.
- Give me a deploy checklist for Vercel + GoDaddy DNS cutover.

## Part D: Budget Hacks That Save Real Money

- Use one stack for all projects to reduce learning time.
- Prefer static pages when possible.
- Reuse one design system across brands.
- Buy one high-quality template and adapt repeatedly.
- Use free tiers first: Vercel, Cloudflare DNS, GitHub.
- Keep third-party paid tools minimal.
- Avoid paid plugins until manual process proves demand.
- Batch content creation monthly to avoid churn.
- Use image compression before upload.
- Host videos on YouTube/Vimeo embeds instead of self-hosting.
- Use aliases for contact emails to isolate spam.
- Keep pages lean to reduce bounce and ad spend waste.
- Build one strong landing page before adding many pages.
- Track only key metrics: visits, inquiries, bookings.
- Cancel unused subscriptions every month.

## Part E: Your Repeatable 7-Step Workflow for Any New Website

1. Define goal, audience, and offer.
2. Draft sitemap and page outlines.
3. Scaffold project and navigation.
4. Build pages in priority order.
5. QA on mobile and desktop.
6. Deploy to Vercel and connect domain.
7. Improve weekly based on real user behavior.

## Part F: What To Do Next On XansEye

1. Replace placeholder text with your final copy.
2. Add 6-12 best portfolio images per service page.
3. Push to GitHub.
4. Deploy on Vercel.
5. Point GoDaddy DNS to Vercel.
6. Verify https for xanseye.com and www.xanseye.com.
7. Keep old GoDaddy hosting for 72 hours, then cancel.
