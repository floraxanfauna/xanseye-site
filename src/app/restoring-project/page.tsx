import { SiteShell } from "@/components/SiteShell";
import type { Metadata } from "next";
import { AutoGallerySlideshow } from "@/components/AutoGallerySlideshow";
import { getPagePhotoUrls } from "@/lib/pagePhotos";
import { saltLakePhotographerKeywords } from "@/lib/seo";
import styles from "../inner-page.module.css";

const restoringImages = getPagePhotoUrls("restoring-project");
const restoringFeatureImages = getPagePhotoUrls("restoring-project");

export const metadata: Metadata = {
  title: "Restoring The Moment | Salt Lake City Photographer",
  description:
    "Artistic historical-site photography project by Xan's Eye Photography, based in Salt Lake City, Utah.",
  keywords: [...saltLakePhotographerKeywords, "Salt Lake City artistic photographer", "Utah historical site photography"],
  alternates: {
    canonical: "/restoring-project",
  },
};

export default function RestoringProjectPage() {
  return (
    <SiteShell currentPath="/restoring-project">
      <main className={styles.main}>
        <section className={styles.restoreStack}>
          <div className={styles.restoreLines}>
            <div>RESTORING THE MOMENT</div>
            <div>Still and thoughtful I stood at each site.</div>
            <div>Still and grateful I thought through each scene.</div>
            <div>Still and hopeful I captured a moment for you to really see.</div>
          </div>

          <p className={styles.restoreAccent}>Artistic photography of LDS Historical Sites</p>
        </section>

        <hr className={styles.sectionRule} />

        <section className={styles.restoreCallout}>
          <p className={styles.restoreCalloutTitle}>Find my LDS History Site Photography at</p>
          <p className={styles.restoreCalloutLink}>RestoringTheMoment.com</p>
        </section>

        <AutoGallerySlideshow images={restoringImages} label="Restoring gallery" className={styles.pageSlideshow} />

        <AutoGallerySlideshow
          images={restoringFeatureImages}
          label="Restoring feature slideshow"
          className={styles.accentSlideshow}
          intervalMs={3500}
        />
      </main>
    </SiteShell>
  );
}