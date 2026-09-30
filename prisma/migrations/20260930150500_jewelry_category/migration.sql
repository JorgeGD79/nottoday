-- Categoría "Joyas": la tienda le dedica una sección propia (store.html#joyas),
-- que busca los productos por este slug. Si ya existía, no se toca.
INSERT INTO "Category" ("id", "name", "slug", "description", "seoTitle", "seoDescription", "sortOrder", "updatedAt")
VALUES (
  'category_joyas',
  'Joyas',
  'joyas',
  'Anillos, collares, pendientes y pulseras de NOT TODAY.',
  'Joyas — NOT TODAY',
  'Joyas de NOT TODAY: anillos, collares, pendientes y pulseras con nuestra propia visión.',
  100,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;
