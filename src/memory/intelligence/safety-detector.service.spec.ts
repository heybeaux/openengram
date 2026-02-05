import { SafetyDetectorService } from './safety-detector.service';

describe('SafetyDetectorService', () => {
  let detector: SafetyDetectorService;

  beforeEach(() => {
    detector = new SafetyDetectorService();
  });

  describe('detectSafetyCritical', () => {
    describe('allergy detection', () => {
      it('should detect "allergic to peanuts"', () => {
        const result = detector.detectSafetyCritical("I'm allergic to peanuts");

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('allergy');
      });

      it('should detect "peanut allergy"', () => {
        const result = detector.detectSafetyCritical('I have a peanut allergy');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('allergy');
      });

      it('should detect "food allergies"', () => {
        const result = detector.detectSafetyCritical('I have food allergies');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('allergy');
      });

      it('should detect anaphylaxis', () => {
        const result = detector.detectSafetyCritical(
          'I carry an epipen due to anaphylaxis risk'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('allergy');
      });
    });

    describe('medication detection', () => {
      it('should detect "my medication is"', () => {
        const result = detector.detectSafetyCritical('My medication is Lisinopril');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medication');
      });

      it('should detect "prescription drugs"', () => {
        const result = detector.detectSafetyCritical(
          'I take prescription drugs for anxiety'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medication');
      });

      it('should detect insulin', () => {
        const result = detector.detectSafetyCritical('I need insulin twice daily');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medication');
      });

      it('should detect blood thinners', () => {
        const result = detector.detectSafetyCritical(
          'I take blood thinner medication'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medication');
      });
    });

    describe('medical condition detection', () => {
      it('should detect diabetes', () => {
        const result = detector.detectSafetyCritical('I have type 2 diabetes');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('diabetes');
      });

      it('should detect diabetic', () => {
        const result = detector.detectSafetyCritical("I'm diabetic");

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('diabetes');
      });

      it('should detect epilepsy', () => {
        const result = detector.detectSafetyCritical('I have epilepsy');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('seizure');
      });

      it('should detect seizures', () => {
        const result = detector.detectSafetyCritical(
          'I sometimes have seizures'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('seizure');
      });

      it('should detect asthma', () => {
        const result = detector.detectSafetyCritical('I have asthma');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('asthma');
      });

      it('should detect inhaler', () => {
        const result = detector.detectSafetyCritical('I carry an inhaler');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('asthma');
      });

      it('should detect heart condition', () => {
        const result = detector.detectSafetyCritical('I have a heart condition');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medical');
      });

      it('should detect pacemaker', () => {
        const result = detector.detectSafetyCritical('I have a pacemaker');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medical');
      });
    });

    describe('emergency information detection', () => {
      it('should detect emergency contact', () => {
        const result = detector.detectSafetyCritical(
          'My emergency contact is John at 555-1234'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('emergency');
      });

      it('should detect blood type', () => {
        const result = detector.detectSafetyCritical('My blood type is O negative');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medical');
      });

      it('should detect DNR', () => {
        const result = detector.detectSafetyCritical('I have a DNR order');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medical_directive');
      });

      it('should detect do not resuscitate', () => {
        const result = detector.detectSafetyCritical(
          'Do not resuscitate if cardiac arrest occurs'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medical_directive');
      });
    });

    describe('critical severity detection', () => {
      it('should detect life-threatening', () => {
        const result = detector.detectSafetyCritical(
          'I have a life-threatening allergy'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('critical');
      });

      it('should detect deathly', () => {
        const result = detector.detectSafetyCritical(
          "I'm deathly afraid of needles"
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('critical');
      });

      it('should detect fatal', () => {
        const result = detector.detectSafetyCritical(
          'Could be fatal if exposed to shellfish'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('critical');
      });
    });

    describe('non-safety text', () => {
      it('should return false for normal text', () => {
        const result = detector.detectSafetyCritical(
          'I like to go hiking on weekends'
        );

        expect(result.isSafety).toBe(false);
        expect(result.indicators).toHaveLength(0);
      });

      it('should return false for work-related text', () => {
        const result = detector.detectSafetyCritical(
          'I prefer working in the morning'
        );

        expect(result.isSafety).toBe(false);
        expect(result.indicators).toHaveLength(0);
      });

      it('should return false for preference text', () => {
        const result = detector.detectSafetyCritical(
          'I always drink my coffee black'
        );

        expect(result.isSafety).toBe(false);
        expect(result.indicators).toHaveLength(0);
      });
    });

    describe('case insensitivity', () => {
      it('should detect ALLERGY in uppercase', () => {
        const result = detector.detectSafetyCritical(
          'I HAVE AN ALLERGY TO SHELLFISH'
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('allergy');
      });

      it('should detect MeDiCaTiOn in mixed case', () => {
        const result = detector.detectSafetyCritical('My MeDiCaTiOn is important');

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('medication');
      });
    });

    describe('multiple indicators', () => {
      it('should detect multiple safety indicators', () => {
        const result = detector.detectSafetyCritical(
          "I'm diabetic and allergic to penicillin. My emergency contact is my wife."
        );

        expect(result.isSafety).toBe(true);
        expect(result.indicators).toContain('diabetes');
        expect(result.indicators).toContain('allergy');
        expect(result.indicators).toContain('emergency');
        expect(result.indicators.length).toBe(3);
      });

      it('should not duplicate indicators', () => {
        const result = detector.detectSafetyCritical(
          "I'm allergic to peanuts and have many food allergies including allergy to shellfish"
        );

        expect(result.isSafety).toBe(true);
        const allergyCount = result.indicators.filter(
          (i) => i === 'allergy'
        ).length;
        expect(allergyCount).toBe(1);
      });
    });
  });

  describe('addPattern', () => {
    it('should allow adding custom patterns', () => {
      detector.addPattern(/\bcustom danger\b/i, 'custom');

      const result = detector.detectSafetyCritical('This is a custom danger zone');

      expect(result.isSafety).toBe(true);
      expect(result.indicators).toContain('custom');
    });
  });
});
