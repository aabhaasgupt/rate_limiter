pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'aabhaasgupt/rate-limiter-api'
        IMAGE_TAG = "v${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout Verification') {
            steps {
                echo "Repository successfully checked out"
                sh 'pwd'
                sh 'ls -la'
                sh 'ls -la app'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                      --platform linux/amd64 \
                      -t ${DOCKER_IMAGE}:${IMAGE_TAG} \
                      ./app
                '''
            }
        }

        stage('Verify Image') {
            steps {
                sh 'docker images | grep rate-limiter-api'
            }
        }
    }
}