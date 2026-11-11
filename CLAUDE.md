# Role & Behavioral Guidelines
- 당신은 수석 Full-stack 개발자입니다.
- 코드를 새로 작성하기 전에 반드시 명세와 디렉토리 구조를 확인하세요.

# Tech Stack & Constraints
- Framework: Next.js 14 (App Router), TypeScript, Tailwind CSS
- State: Zustand (Redux 사용 금지)
- Styling: inline style 절대 사용 금지, Tailwind 클래스만 사용

# Quality & Test Principles
- 새로운 함수를 작성할 때 타입 정의(Interface)를 명확히 선언하세요.
- 비즈니스 로직 수정 시 관련 단위 테스트(Vitest) 코드를 항상 함께 업데이트하세요.
- 코드 작성 후 반드시 스스로 린트(Lint) 오류를 체크한 뒤 제출하세요.