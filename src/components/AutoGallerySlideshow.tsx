"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import styles from "./AutoGallerySlideshow.module.css";

type AutoGallerySlideshowProps = {
  images: string[];
  label: string;
  className?: string;
  intervalMs?: number;
  showArrows?: boolean;
  heroStyle?: boolean;
  pinFirstKeyword?: string;
};

export function AutoGallerySlideshow({
  images,
  label,
  className,
  intervalMs = 3200,
  showArrows = false,
  heroStyle = false,
  pinFirstKeyword,
}: AutoGallerySlideshowProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const deterministicRank = (value: string) => {
    // Use a deterministic hash so server/client render the same slide order.
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const safeImages = useMemo(() => {
    const filtered = images.filter(Boolean);
    const normalizedPinKeyword = pinFirstKeyword?.trim().toLowerCase();

    const isPinnedFirst = (src: string) => {
      if (!normalizedPinKeyword) {
        return false;
      }

      const rawName = src.split("/").pop() ?? "";
      const fileName = decodeURIComponent(rawName);
      return fileName.toLowerCase().startsWith(normalizedPinKeyword);
    };

    const getNumericFileOrder = (src: string) => {
      const rawName = src.split("/").pop() ?? "";
      const fileName = decodeURIComponent(rawName);
      const dotIndex = fileName.lastIndexOf(".");
      const baseName = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);

      if (!/^\d+$/.test(baseName)) {
        return null;
      }

      return Number(baseName);
    };

    return [...filtered].sort((left, right) => {
      const leftPinned = isPinnedFirst(left);
      const rightPinned = isPinnedFirst(right);

      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      const leftNumericOrder = getNumericFileOrder(left);
      const rightNumericOrder = getNumericFileOrder(right);
      const leftIsNumeric = leftNumericOrder !== null;
      const rightIsNumeric = rightNumericOrder !== null;

      if (leftIsNumeric !== rightIsNumeric) {
        return leftIsNumeric ? -1 : 1;
      }

      if (leftIsNumeric && rightIsNumeric && leftNumericOrder !== rightNumericOrder) {
        return leftNumericOrder - rightNumericOrder;
      }

      const leftRank = deterministicRank(`${label}:${left}`);
      const rightRank = deterministicRank(`${label}:${right}`);

      if (leftRank === rightRank) {
        return left.localeCompare(right);
      }

      return leftRank - rightRank;
    });
  }, [images, label, pinFirstKeyword]);
  const activeSlideIndex = safeImages.length === 0 ? 0 : activeIndex % safeImages.length;

  useEffect(() => {
    if (safeImages.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % safeImages.length);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, safeImages]);

  if (safeImages.length === 0) {
    return (
      <section className={`${styles.slideshow} ${className ?? ""}`} aria-label={label}>
        <div className={`${styles.frame} ${heroStyle ? styles.heroFrame : ""}`}>
          <div className={styles.empty}>Add photos to this page folder to start the slideshow.</div>
        </div>
      </section>
    );
  }

  const goToPrevious = () => {
    setActiveIndex((current) => (current - 1 + safeImages.length) % safeImages.length);
  };

  const goToNext = () => {
    setActiveIndex((current) => (current + 1) % safeImages.length);
  };

  return (
    <section className={`${styles.slideshow} ${className ?? ""}`} aria-label={label}>
      <div className={`${styles.frame} ${heroStyle ? styles.heroFrame : ""}`}>
        {safeImages.map((src, index) => (
          <Image
            key={src}
            src={src}
            alt={`${label} image ${index + 1}`}
            className={`${styles.slide} ${index === activeSlideIndex ? styles.active : ""}`}
            fill
            sizes="100vw"
            priority={index === 0}
          />
        ))}

        {showArrows && safeImages.length > 1 ? (
          <>
            <button type="button" className={`${styles.navButton} ${styles.navPrev}`} onClick={goToPrevious} aria-label={`Previous ${label} image`}>
              <span aria-hidden="true">&#8249;</span>
            </button>
            <button type="button" className={`${styles.navButton} ${styles.navNext}`} onClick={goToNext} aria-label={`Next ${label} image`}>
              <span aria-hidden="true">&#8250;</span>
            </button>
          </>
        ) : null}
      </div>

      {safeImages.length > 1 ? (
        <div className={styles.dots} aria-hidden="true">
          {safeImages.map((src, index) => (
            <span
              key={src}
              className={`${styles.dot} ${index === activeSlideIndex ? styles.dotActive : ""}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
