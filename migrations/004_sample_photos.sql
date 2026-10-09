-- Point the demo season at the four sample photos that ship with the site.
update seasons set
  draft = jsonb_set(draft, '{photos}', '[
    {"url":"/sample-photos/mini-1-mountain-family.jpg","alt":"Sample photo: a family of six posing together on a green mountain hillside"},
    {"url":"/sample-photos/mini-2-golden-light.jpg","alt":"Sample photo: a smiling couple with their toddler son in warm golden evening light"},
    {"url":"/sample-photos/mini-3-jumping-kids.jpg","alt":"Sample photo: five children holding hands and jumping against a white studio backdrop"},
    {"url":"/sample-photos/mini-4-garden-walk.jpg","alt":"Sample photo: a couple walking hand in hand with their young son along a shaded garden path"}
  ]'::jsonb),
  published = case when published is null then null else jsonb_set(published, '{photos}', '[
    {"url":"/sample-photos/mini-1-mountain-family.jpg","alt":"Sample photo: a family of six posing together on a green mountain hillside"},
    {"url":"/sample-photos/mini-2-golden-light.jpg","alt":"Sample photo: a smiling couple with their toddler son in warm golden evening light"},
    {"url":"/sample-photos/mini-3-jumping-kids.jpg","alt":"Sample photo: five children holding hands and jumping against a white studio backdrop"},
    {"url":"/sample-photos/mini-4-garden-walk.jpg","alt":"Sample photo: a couple walking hand in hand with their young son along a shaded garden path"}
  ]'::jsonb) end
where name = 'Autumn Mini Sessions'
  and coalesce(draft->'photos'->0->>'alt', '') like 'Sample photo:%';
