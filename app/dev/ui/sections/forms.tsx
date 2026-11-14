"use client";

/**
 * Gallery section: form primitives (V2-06 06-02a, P1-28 M2 2a; 06-UI-SPEC "06-02a Forms"). Synthetic copy only.
 * Forced hover / pressed / focus specimens apply the same token classes the primitive applies on interaction, so a
 * static capture shows every state; the live specimens are what the keyboard specs drive.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

function ButtonGroup() {
  const [count, setCount] = useState(0);
  return (
    <>
      <GalleryGroup
        id="button-variants"
        title="Button · variants"
        note="One primary per view region. Soft for the emphasised secondary, secondary for everything else, ghost for inline and row actions, danger only to confirm a destructive action."
      >
        <Specimen label="Primary">
          <Button variant="primary">Finish visit</Button>
        </Specimen>
        <Specimen label="Soft">
          <Button variant="soft">Create prescription</Button>
        </Specimen>
        <Specimen label="Secondary">
          <Button variant="secondary">Reschedule</Button>
        </Specimen>
        <Specimen label="Ghost">
          <Button variant="ghost">Cancel</Button>
        </Specimen>
        <Specimen label="Danger">
          <Button variant="danger">Cancel visit</Button>
        </Specimen>
        <Specimen label="Danger quiet">
          <Button variant="danger-quiet">Remove</Button>
        </Specimen>
        <Specimen label="Link">
          <Button variant="link">View history</Button>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="button-sizes" title="Button · sizes" note="28, 36 and 44 px on a fine pointer; 44 px on touch.">
        <Specimen label="Small">
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        </Specimen>
        <Specimen label="Default">
          <Button variant="secondary">Back to note</Button>
        </Specimen>
        <Specimen label="Large">
          <Button variant="primary" size="lg">
            Sign and finish
          </Button>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="button-states" title="Button · states">
        <Specimen label="Default" state="default">
          <Button variant="primary" data-testid="button-live" onClick={() => setCount((n) => n + 1)}>
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Hover" state="hover">
          <Button variant="primary" tabIndex={-1} className="bg-(--button-primary-bg-hover)">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Pressed" state="pressed">
          <Button variant="primary" tabIndex={-1} className="bg-(--button-primary-bg-pressed)">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Focus" state="focus">
          <Button variant="primary" tabIndex={-1} className="focus-ring">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Disabled" state="disabled">
          <Button variant="primary" disabled data-testid="button-disabled">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Loading" state="loading">
          <Button variant="primary" loading data-testid="button-loading">
            Add to queue
          </Button>
        </Specimen>
        <Specimen label="Loading · secondary" state="loading">
          <Button variant="secondary" loading>
            Back to note
          </Button>
        </Specimen>
        <Specimen label="After the live button" state="default">
          <Button variant="secondary" data-testid="button-after">
            Reschedule
          </Button>
        </Specimen>
      </GalleryGroup>
      <p role="status" data-testid="button-count" className="text-label text-fg-muted">
        Add to queue pressed {count} {count === 1 ? "time" : "times"}
      </p>
    </>
  );
}

export function FormsSection() {
  return (
    <GallerySection
      id="forms"
      title="Forms"
      intro="Buttons, inputs, selects, toggles and chip groups (06-02a). Every state is shown; tab through the live specimens to see the focus ring."
    >
      <ButtonGroup />
    </GallerySection>
  );
}
