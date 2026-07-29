# Custom TeX + pandoc image for mcp-latex.
#
# The upstream `pandoc/latex` image is minimal and lacks the LaTeX packages our
# tuned header.tex needs (fancyhdr / lastpage / newunicodechar / xcolor). It is
# also amd64-only. We install the missing packages at build time so renders work
# offline and without an in-container network round-trip.
#
# Note: the upstream image's bundled tlmgr can be out of sync with the live
# tlnet repository, so we `tlmgr update --self` against an explicit mirror first.
FROM pandoc/latex:latest

RUN tlmgr option repository https://mirror.ctan.org/systems/texlive/tlnet \
    && tlmgr update --self \
    && tlmgr install fancyhdr lastpage newunicodechar xcolor \
    && mktexlsr
