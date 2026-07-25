"use client";

import { FormEvent, useState } from "react";
import styles from "@/app/inner-page.module.css";

const CONTACT_EMAIL = "XanHopePhotography@gmail.com";

type Challenge = {
  left: number;
  right: number;
};

function generateChallenge(): Challenge {
  return {
    left: Math.floor(Math.random() * 8) + 2,
    right: Math.floor(Math.random() * 8) + 2,
  };
}

export function EmailVerificationReveal() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [answer, setAnswer] = useState("");
  const [verified, setVerified] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const startVerification = () => {
    setChallenge(generateChallenge());
    setAnswer("");
    setVerified(false);
    setErrorMessage("");
  };

  const verifyHuman = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!challenge) {
      return;
    }

    const expected = challenge.left + challenge.right;
    const provided = Number(answer.trim());

    if (Number.isNaN(provided) || provided !== expected) {
      setErrorMessage("That answer is not correct. Please try again.");
      setChallenge(generateChallenge());
      setAnswer("");
      setVerified(false);
      return;
    }

    setVerified(true);
    setErrorMessage("");
  };

  return (
    <section className={styles.emailGateSection}>
      <button
        type="button"
        className={styles.emailGateButton}
        onClick={startVerification}
      >
        Click Here for Xan&apos;s Email
      </button>

      {challenge && !verified ? (
        <form className={styles.emailChallengeCard} onSubmit={verifyHuman}>
          <p className={styles.emailChallengePrompt}>
            Human check: what is {challenge.left} + {challenge.right}?
          </p>
          <div className={styles.emailChallengeInputRow}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={styles.emailChallengeInput}
              aria-label="Verification answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <button type="submit" className={styles.emailChallengeConfirm}>
              Verify
            </button>
          </div>
          {errorMessage ? (
            <p className={styles.emailChallengeHint}>{errorMessage}</p>
          ) : null}
        </form>
      ) : null}

      {verified ? (
        <div className={styles.emailRevealCard}>
          <p className={styles.emailRevealTitle}>Verified. Xan&apos;s email:</p>
          <p className={styles.emailRevealAddress}>{CONTACT_EMAIL}</p>
          <div className={styles.emailRevealActions}>
            <a href={`mailto:${CONTACT_EMAIL}`} className={styles.emailRevealAction}>
              Open Email App
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}