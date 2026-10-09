-- LP rewrite deploy (task 4): a rewrite brief can be generated from a
-- built-in template before any LandingPage exists, so the source page
-- reference becomes nullable. Template-sourced drafts store their base HTML
-- in rewritten_content.baseHtml instead.
ALTER TABLE "landing_page_rewrites" ALTER COLUMN "landing_page_id" DROP NOT NULL;
