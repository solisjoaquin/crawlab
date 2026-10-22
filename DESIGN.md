# Crawlab design reference

Source: https://www.firecrawl.dev/press-brand
Captured October 21, 2026 with Firecrawl branding, markdown and screenshot formats.
The screenshot URL was returned, but could not be downloaded or visually inspected
because network access and browser availability were limited. Layout choices below
are adaptations, not a pixel-perfect reconstruction.

## Observed brand tokens

The published brand guide specifies Heat #FA5D19, Graphite #262626 and Paper #F9F9F9.
The branding extractor reports #FF4D00 as the page primary; this implementation
prioritizes the explicit published Heat swatch. Background and text match the guide.
Extracted typography uses Suisse, 40px h1, 32px h2 and 16px body. Suisse was not
available locally; Arial/Helvetica/system fonts are used as a fallback.
Extracted component styles include #E8E8E8 borders and 8–10px corner radii.

## Implementation choices

Light Paper canvas, subtle dotted grid, Graphite text and Heat highlights.
The header uses the plain Crawlab name and a Lab badge. Third-party wordmarks
and branding/documentation links were removed at the user's request.
No marketing photos are needed for this comparison tool.

The header contains the Crawlab name and Lab badge. A spacious hero
leads into a bordered form card with URL entry, option chips, selector fields and
post-processing and a page-type selector. A preservation panel exposes metadata,
sources, collection coverage and warnings. An empty state explains the next action. Results use two cards:
the baseline and the configured output after post-processing.
The 1200px container, spacing, hero scale, dotted grid and result layout are local
design choices. Mobile stacks the URL action, selector fields and result cards.
Controls have explicit labels and keyboard focus styles; status updates use a
live region. A hidden attribute override keeps result cards hidden before a run.
