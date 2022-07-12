.PHONY: check

check:
	find . -name "*.yml" -type f ! -path "*/node_modules/*" ! -path "./.github/*" -mindepth 2 -print0 | xargs -0 -n1 cfn-lint --template
	npm run tsc
	npm run eslint -- "**/*.js"
	npm run prettier -- --check "**/*.{js,json,yml}"
	python -m black --check ./
	python -m flake8
