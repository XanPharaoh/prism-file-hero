# Reproducible headless office→pdf engine for processing/libreofficeProvider.ts (checks D/G converter).
# Build:  docker build -t prism-lo tools/libreoffice
# The test wrapper scripts/run-conversions.mjs builds this automatically and shims `soffice`
# onto PATH (bind-mounting each throwaway temp dir at the identical host path, running as the
# host uid so the provider's own cleanup can delete generated files). poppler-utils gives the
# conversions check real page counts (pdfinfo) and rendered-text proof (pdftotext).
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-liberation poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["soffice"]
