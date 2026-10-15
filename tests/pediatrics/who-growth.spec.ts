import { describe, it, expect } from "vitest";
import {
  calculateWhoGrowthPercentile,
  getLmsParams,
  normalCdf,
} from "../../lib/pediatrics/who-data";

describe("WHO LMS Child Growth Percentile Engine", () => {
  it("calculates exact Z-score and normal 50th percentile for standard reference point", () => {
    // 24-month-old boy: Weight 12.2kg corresponds to 50th percentile
    const result = calculateWhoGrowthPercentile({
      ageMonths: 24,
      gender: "male",
      metric: "weight",
      value: 12.2,
    });

    expect(result.percentile).toBeCloseTo(50, 0);
    expect(result.badgeCategory).toBe("normal");
    expect(result.variant).toBe("success");
    expect(result.zScore).toBeCloseTo(0, 1);
  });

  it("classifies values below 3rd percentile as stunted/underweight", () => {
    const result = calculateWhoGrowthPercentile({
      ageMonths: 24,
      gender: "male",
      metric: "weight",
      value: 9.0, // severely underweight
    });

    expect(result.percentile).toBeLessThan(3);
    expect(result.badgeCategory).toBe("underweight");
    expect(result.variant).toBe("error");
    expect(result.zScore).toBeLessThan(-2);
  });

  it("classifies values above 97th percentile as overweight", () => {
    const result = calculateWhoGrowthPercentile({
      ageMonths: 24,
      gender: "male",
      metric: "weight",
      value: 16.0, // well above 97th percentile
    });

    expect(result.percentile).toBeGreaterThan(97);
    expect(result.badgeCategory).toBe("overweight");
    expect(result.variant).toBe("error");
  });

  it("correctly evaluates height-for-age metrics and identifies stunted status", () => {
    const normalHeight = calculateWhoGrowthPercentile({
      ageMonths: 12,
      gender: "female",
      metric: "height",
      value: 74.0, // Median for 12m female is ~74.0cm
    });

    expect(normalHeight.percentile).toBeCloseTo(50, 0);
    expect(normalHeight.badgeCategory).toBe("normal");

    const stuntedHeight = calculateWhoGrowthPercentile({
      ageMonths: 12,
      gender: "female",
      metric: "height",
      value: 65.0, // severely stunted
    });

    expect(stuntedHeight.percentile).toBeLessThan(3);
    expect(stuntedHeight.badgeCategory).toBe("stunted");
  });

  it("correctly evaluates head circumference metrics", () => {
    const normalHead = calculateWhoGrowthPercentile({
      ageMonths: 6,
      gender: "male",
      metric: "head_circumference",
      value: 43.1, // Median for 6m male is 43.1cm
    });

    expect(normalHead.percentile).toBeCloseTo(50, 0);
    expect(normalHead.badgeCategory).toBe("normal");
  });

  it("computes normal CDF accurately across range", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("safely handles edge ages with clamping", () => {
    const newborn = getLmsParams("male", "weight", -5);
    expect(newborn.m).toBeCloseTo(3.346, 2);

    const fiveYearOld = getLmsParams("female", "weight", 72);
    expect(fiveYearOld.m).toBeCloseTo(18.237, 2);
  });
});
