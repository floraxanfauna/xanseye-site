"use client";

import { useState, type FormEvent } from "react";
import styles from "@/app/inner-page.module.css";

const inquiryOptions = [
  "Instagram",
  "Facebook",
  "Google Search",
  "Referral",
  "Returning Client",
  "Other",
];

const photoShootOptions = [
  "Wedding",
  "Engagement",
  "Family",
  "Newborn",
  "Maternity",
  "Senior",
  "Commercial",
  "Boudoir",
  "Other",
];

const flexibleOptions = ["Yes", "No", "Maybe"];

function buildMailtoBody(form: HTMLFormElement) {
  const data = new FormData(form);
  const lines = [
    `Your Name: ${String(data.get("name") ?? "")}`,
    `How did you hear about me?: ${String(data.get("found") ?? "")}`,
    `Your Email Address: ${String(data.get("email") ?? "")}`,
    `Phone Number: ${String(data.get("phone") ?? "")}`,
    `What kind of photo shoot are you inquiring about?: ${String(data.get("shootType") ?? "")}`,
    `Idea Date of Shoot: ${String(data.get("shootDate") ?? "")}`,
    `Are you flexible on the date?: ${String(data.get("flexible") ?? "")}`,
    "",
    "Other notes for me to know:",
    String(data.get("notes") ?? ""),
  ];

  return lines.join("\n");
}

export function ContactInquiryForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const subject = encodeURIComponent(
      `Xan's Eye Photography Inquiry - ${String(formData.get("name") ?? "New Client")}`,
    );
    const body = encodeURIComponent(buildMailtoBody(form));

    setIsSubmitting(true);
    window.location.href = `mailto:XanFloraFauna@gmail.com?subject=${subject}&body=${body}`;
    window.setTimeout(() => setIsSubmitting(false), 600);
  }

  return (
    <form className={styles.contactForm} onSubmit={handleSubmit}>
      <label className={styles.contactField}>
        <span className={styles.contactLabel}>YOUR NAME *</span>
        <input className={styles.contactInput} type="text" name="name" required />
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>HOW DID YOU HEAR ABOUT ME? *</span>
        <select className={styles.contactInput} name="found" defaultValue="" required>
          <option value="" disabled>
            Select an option
          </option>
          {inquiryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>YOUR EMAIL ADDRESS *</span>
        <input className={styles.contactInput} type="email" name="email" required />
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>PHONE NUMBER *</span>
        <input className={styles.contactInput} type="tel" name="phone" required />
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>WHAT KIND OF PHOTO SHOOT ARE YOU INQUIRING ABOUT? *</span>
        <select className={styles.contactInput} name="shootType" defaultValue="" required>
          <option value="" disabled>
            Select an option
          </option>
          {photoShootOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>IDEA DATE OF SHOOT *</span>
        <input className={styles.contactInput} type="date" name="shootDate" required />
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>ARE YOU FLEXIBLE ON THE DATE? *</span>
        <select className={styles.contactInput} name="flexible" defaultValue="" required>
          <option value="" disabled>
            Select an option
          </option>
          {flexibleOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.contactField}>
        <span className={styles.contactLabel}>OTHER NOTES FOR ME TO KNOW *</span>
        <textarea
          className={styles.contactTextarea}
          name="notes"
          rows={5}
          placeholder="Anything else you want me to know before we connect."
          required
        />
      </label>

      <div className={styles.contactSubmitRow}>
        <button type="submit" className={styles.submitButton} disabled={isSubmitting}>
          {isSubmitting ? "OPENING EMAIL..." : "SEND"}
        </button>
      </div>
    </form>
  );
}