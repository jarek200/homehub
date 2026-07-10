.PHONY: install scaffold deploy-dev deploy-stage deploy-prod info-dev info-stage info-prod destroy-dev

scaffold:
	npx create-webiny-project .

install:
	yarn install

deploy-dev:
	yarn webiny deploy --env dev

deploy-stage:
	yarn webiny deploy --env stage

deploy-prod:
	yarn webiny deploy --env prod

info-dev:
	yarn webiny info --env dev

info-stage:
	yarn webiny info --env stage

info-prod:
	yarn webiny info --env prod

# Safe: dev only — never expose a destroy target for stage or prod
destroy-dev:
	yarn webiny destroy --env dev
