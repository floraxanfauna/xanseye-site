-- Switch seasons still on the original "autumn" colors to the Forest look (light tan, forest green, light blue).
update seasons set
  draft = jsonb_set(jsonb_set(draft, '{theme}', '"forest"'), '{colors}',
    '{"bg":"#F3EADB","surface":"#FBF7EE","text":"#1E2B22","accent":"#1F4D37","accentText":"#FBF7EE","sage":"#CFE3F0","gold":"#8FB8D6"}'::jsonb),
  published = case when published is null then null else jsonb_set(jsonb_set(published, '{theme}', '"forest"'), '{colors}',
    '{"bg":"#F3EADB","surface":"#FBF7EE","text":"#1E2B22","accent":"#1F4D37","accentText":"#FBF7EE","sage":"#CFE3F0","gold":"#8FB8D6"}'::jsonb) end
where draft->>'theme' = 'autumn';
