/**
 * Reshaped ships its design tokens as raw PostCSS custom media, so the theme
 * file has to pass through @reshaped/postcss (see the Reshaped docs).
 */
module.exports = {
  plugins: {
    "postcss-import": {},
    "postcss-nested": {},
    autoprefixer: {},
  },
};
